#!/usr/bin/env bash
#
# Auto-merge sweep - merges the open pull requests that have no conflict
# with `main` and whose CI gate is green. The workflow that calls this script
# lives in .github/workflows/auto-merge.yml, the rules in docs/auto-merge.md.
#
# The script always runs from the BASE branch (the workflow checks out
# `main`), so a pull request can never change the rules that merge it.
#
# A PR is merged only when a CI run exists that
#   * belongs to the CURRENT head commit of the PR,
#   * tested the PR against the CURRENT `main` (a `pull_request` run whose
#     base SHA is the current main, or a run dispatched on the PR merge ref),
#   * and whose blocking jobs (`gate`) are green.
# A green run against an older `main` does not count: the merge result would
# be unverified.
#
# Environment:
#   GITHUB_REPOSITORY            owner/repo (required)
#   GH_TOKEN                     token used for the API calls and for the merge
#   AUTOMERGE_TOKEN_SOURCE       "pat" (a PAT: its pushes trigger workflows)
#                                 or "bot" (GITHUB_TOKEN: they do not)
#   AUTOMERGE_MERGE_METHOD       merge | squash | rebase        (default: merge)
#   AUTOMERGE_REQUIRED_CHECKS    blocking CI jobs              (default: gate)
#   AUTOMERGE_ADVISORY_CHECKS    jobs that never block a merge  (default: live-e2e)
#   AUTOMERGE_IGNORED_CHECKS     jobs that never decide the verdict
#                                 (default: sweep - the sweep's own job)
#   AUTOMERGE_BLOCKED_PATHS      paths a PR may not touch to be auto-merged
#                                 (default: empty - the owner decides, see
#                                 docs/auto-merge.md §6)
#   AUTOMERGE_BLOCK_LABELS       comma separated labels         (default:
#                                 automerge:block,needs-human)
#   AUTOMERGE_REQUIRE_MAIN_GREEN true | false                   (default: true)
#   AUTOMERGE_DISPATCH_CI        auto | never                  (default: auto)
#   AUTOMERGE_DRY_RUN            true | false                  (default: false)
#   CI_WORKFLOW                  workflow file to re-dispatch  (default: ci.yml)

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-}"
MERGE_METHOD="${AUTOMERGE_MERGE_METHOD:-merge}"
BASE_BRANCH="${AUTOMERGE_BASE_BRANCH:-main}"
REQUIRED_CHECKS="${AUTOMERGE_REQUIRED_CHECKS:-gate}"
ADVISORY_CHECKS="${AUTOMERGE_ADVISORY_CHECKS:-live-e2e}"
IGNORED_CHECKS="${AUTOMERGE_IGNORED_CHECKS:-sweep}"
BLOCKED_PATHS="${AUTOMERGE_BLOCKED_PATHS:-}"
BLOCK_LABELS="${AUTOMERGE_BLOCK_LABELS:-automerge:block,needs-human}"
REQUIRE_MAIN_GREEN="${AUTOMERGE_REQUIRE_MAIN_GREEN:-true}"
DISPATCH_CI="${AUTOMERGE_DISPATCH_CI:-auto}"
DRY_RUN="${AUTOMERGE_DRY_RUN:-false}"
TOKEN_SOURCE="${AUTOMERGE_TOKEN_SOURCE:-bot}"
CI_WORKFLOW="${CI_WORKFLOW:-ci.yml}"

validate_config() {
  if [ -z "$REPO" ]; then
    echo "GITHUB_REPOSITORY is required" >&2
    exit 2
  fi
  case "$MERGE_METHOD" in
    merge | squash | rebase) ;;
    *)
      echo "AUTOMERGE_MERGE_METHOD must be merge, squash or rebase" >&2
      exit 2
      ;;
  esac
  if ignored_conflicts_with_required; then
    echo "AUTOMERGE_IGNORED_CHECKS must not name a required check ($REQUIRED_CHECKS)" >&2
    exit 2
  fi
}

# ignored_conflicts_with_required -> 0 when the ignore list names a required
# check. The ignore list says "this job decides nothing"; a required check
# that decides nothing would remove the gate from the verdict, so the
# configuration is rejected instead of silently accepted.
ignored_conflicts_with_required() {
  local ign req
  for ign in $(echo "$IGNORED_CHECKS" | tr ',' ' '); do
    [ -n "$ign" ] || continue
    for req in $(echo "$REQUIRED_CHECKS" | tr ',' ' '); do
      [ -n "$req" ] || continue
      [ "$ign" = "$req" ] && return 0
    done
  done
  return 1
}

SUMMARY_ROWS=""
MERGED_COUNT=0
# The PRs this sweep already dispatched a gate for, " <n> <n> ". decide_pr
# runs in a subshell, so the main loop records them from the decision. The
# refresh pass skips them: the run it just dispatched is not listed by the
# API yet, and a second dispatch would occupy the single runner twice.
DISPATCHED_PRS=" "
SKIPPED_COUNT=0
FAILED_COUNT=0
MAIN_SHA=""

log() {
  printf '%s %s\n' "$(date -u '+%H:%M:%S')" "$*" >&2
}

# fail <message> - a broken sweep must turn the job red: a sweep that could
# not do its work is not a sweep that found nothing to merge.
fail() {
  printf '::error::%s\n' "$*"
  exit 1
}

# preflight - the tools and the API access the sweep cannot work without.
# Without it a missing `gh` or a bad token is swallowed by the `|| true` and
# `2>/dev/null` of the helpers below and the job ends green with nothing done.
preflight() {
  command -v gh >/dev/null 2>&1 || fail "gh is not installed on this runner"
  command -v jq >/dev/null 2>&1 || fail "jq is not installed on this runner"
  gh api "repos/$REPO" --jq '.full_name' >/dev/null 2>&1 \
    || fail "the GitHub API is not reachable or GH_TOKEN cannot read $REPO"
}

# add_row <pr> <title> <decision> <detail>
add_row() {
  SUMMARY_ROWS="${SUMMARY_ROWS}| ${1} | ${2} | ${3} | ${4} |
"
  case "$3" in
    merged | would-merge) MERGED_COUNT=$((MERGED_COUNT + 1)) ;;
    failed) FAILED_COUNT=$((FAILED_COUNT + 1)) ;;
    *) SKIPPED_COUNT=$((SKIPPED_COUNT + 1)) ;;
  esac
}

write_summary() {
  {
    echo "### Auto-merge sweep"
    echo ""
    echo "- repository: \`${REPO}\`"
    echo "- merge method: \`${MERGE_METHOD}\`"
    echo "- token source: \`${TOKEN_SOURCE}\`"
    echo "- dry run: \`${DRY_RUN}\`"
    echo "- merged: ${MERGED_COUNT}, skipped: ${SKIPPED_COUNT}, failed: ${FAILED_COUNT}"
    echo ""
    echo "| PR | title | decision | detail |"
    echo "| --- | --- | --- | --- |"
    printf '%s' "$SUMMARY_ROWS"
  } >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
}

# has_block_label <labels (newline separated)> -> 0 when a block label is set
has_block_label() {
  local labels="$1" label
  for label in $(echo "$BLOCK_LABELS" | tr ',' ' '); do
    if echo "$labels" | grep -qx -- "$label"; then
      return 0
    fi
  done
  return 1
}

refresh_main_sha() {
  local err
  if ! MAIN_SHA="$(gh api "repos/$REPO/commits/${BASE_BRANCH}" --jq '.sha' 2>&1)"; then
    err="$MAIN_SHA"
    MAIN_SHA=""
    log "gh api commits/${BASE_BRANCH} failed: ${err:-no output} (gh: $(command -v gh || echo 'not on PATH'))"
  fi
}

# pr_merge_state <number> -> "<mergeable>|<mergeable_state>"
pr_merge_state() {
  local number="$1" attempt=0 out=""
  while [ "$attempt" -lt 4 ]; do
    out="$(gh api "repos/$REPO/pulls/$number" \
      --jq '[(.mergeable | tostring), (.mergeable_state // "unknown")] | join("|")' 2>/dev/null || true)"
    case "$out" in
      null\|*) sleep 5 ;;
      *) echo "$out"; return 0 ;;
    esac
    attempt=$((attempt + 1))
  done
  echo "unknown|unknown"
}

# merge_ref_sha <number> -> SHA of refs/pull/<number>/merge, empty when absent
merge_ref_sha() {
  gh api "repos/$REPO/git/ref/pull/$1/merge" --jq '.object.sha' 2>/dev/null || true
}

# merge_ref_is_current <merge ref sha> -> 0 when the merge ref was built on
# the current `main`. GitHub builds the merge ref from the base as it was at
# the build and does not rebuild it when `main` moves, so a ref built on an
# older `main` tests the PR against code that is gone. Fails closed: an
# unreadable parent counts as stale.
merge_ref_is_current() {
  local ref_sha="$1" parent
  [ -n "$ref_sha" ] && [ -n "$MAIN_SHA" ] || return 1
  parent="$(gh api "repos/$REPO/commits/$ref_sha" --jq '.parents[0].sha' 2>/dev/null || true)"
  [ -n "$parent" ] && [ "$parent" = "$MAIN_SHA" ]
}

# fresh_ci_run <head_sha> <merge_sha> -> the id of the newest CI run that
# tested the current head against the current main, empty when there is none
fresh_ci_run() {
  local head_sha="$1" merge_sha="$2" runs merge_runs
  runs="$(gh api "repos/$REPO/actions/runs?head_sha=$head_sha&per_page=50" 2>/dev/null || echo '{"workflow_runs":[]}')"
  merge_runs='{"workflow_runs":[]}'
  if [ -n "$merge_sha" ]; then
    merge_runs="$(gh api "repos/$REPO/actions/runs?head_sha=$merge_sha&per_page=50" 2>/dev/null || echo '{"workflow_runs":[]}')"
  fi
  jq -n --argjson a "$runs" --argjson b "$merge_runs" \
    --arg main "$MAIN_SHA" --arg merge "$merge_sha" --arg head "$head_sha" '
    [ ($a.workflow_runs + $b.workflow_runs)[]
      | select(.name == "CI")
      | select(
          ( .event == "pull_request"
            and (.pull_requests[0].head.sha // "") == $head
            and (.pull_requests[0].base.sha // "") == $main )
          or ( .event == "workflow_dispatch" and $merge != "" and .head_sha == $merge )
        )
    ] | sort_by(.run_number) | last | .id // empty'
}

# classify_jobs <jobs tsv> [ignored jobs] -> green | pending | red | missing
# Pure: the tsv is "name<TAB>status<TAB>conclusion" per line.
# The optional second argument lists the jobs that decide nothing. It is
# used only where the jobs are NOT the gate's jobs - the check-runs of a
# commit carry the jobs of every workflow that ran on it (the gate, the
# advisory live lane and the sweep's own job). In the run-scoped path every
# job of the run is a gate job, so nothing is ignored there.
classify_jobs() {
  local jobs="$1" igns="${2:-}" req reqs advs blocking
  if [ -z "$jobs" ]; then
    echo "missing"
    return 0
  fi
  reqs="$(echo "$REQUIRED_CHECKS" | tr ',' ' ')"
  advs="$(echo "$ADVISORY_CHECKS" | tr ',' ' ')"
  igns="$(echo "$igns" | tr ',' ' ')"
  # A job that still runs means the verdict is not in yet - unless it is an
  # advisory job (`live-e2e` never blocks a merge, so it must not hold the
  # sweep back while it runs - on main it runs for up to 90 minutes) or the
  # sweep's own job: the sweep reads the check-runs of `main` while its own
  # job runs on that same commit, so its own in-flight job would keep `main`
  # from ever being green and the sweep would merge nothing.
  # A required job always holds the verdict back, even if the ignore list
  # names it by mistake (the configuration is rejected, see
  # validate_config): the ignore list decides nothing, it does not remove a
  # required job from the verdict.
  if awk -F'\t' -v reqs="$reqs" -v advs="$advs" -v igns="$igns" '
    BEGIN { n = split(reqs, r, " "); m = split(advs, a, " "); k = split(igns, g, " ") }
    {
      isreq = 0; for (i = 1; i <= n; i++) if (r[i] == $1) isreq = 1
      isadv = 0; for (i = 1; i <= m; i++) if (a[i] == $1) isadv = 1
      isign = 0; for (i = 1; i <= k; i++) if (g[i] == $1) isign = 1
      if ($2 != "completed" && (isreq || (!isadv && !isign))) found = 1
    }
    END { exit found ? 0 : 1 }' <<<"$jobs"; then
    echo "pending"
    return 0
  fi
  # A cancelled required run is not a verdict, and a required job that
  # really failed is red whatever the other required jobs say - so the
  # order of the checks must not matter.
  local cancelled=""
  for req in $reqs; do
    [ -n "$req" ] || continue
    local last
    last="$(awk -F'\t' -v n="$req" '$1 == n { c = $3 } END { print c }' <<<"$jobs")"
    if [ -z "$last" ]; then
      echo "missing"
      return 0
    fi
    if [ "$last" = "cancelled" ]; then
      # A cancelled run carries no verdict: the run was superseded or was
      # stopped, so the gate has no verdict yet. The sweep does not call the
      # pull request broken (`CI is red` is the word for a run that failed);
      # it waits for a run with a verdict, the same way it waits for any pull
      # request without a green CI (issue #1204). The verdict is decided
      # after the loop, so a required job that really failed is still red
      # even if another one was cancelled.
      cancelled="yes"
      continue
    fi
    if [ "$last" != "success" ]; then
      echo "red"
      return 0
    fi
  done
  blocking="$(awk -F'\t' -v reqs="$reqs" -v advs="$advs" -v igns="$igns" '
    BEGIN { n = split(reqs, r, " "); m = split(advs, a, " "); k = split(igns, g, " ") }
    {
      isreq = 0; for (i = 1; i <= n; i++) if (r[i] == $1) isreq = 1
      isadv = 0; for (i = 1; i <= m; i++) if (a[i] == $1) isadv = 1
      isign = 0; for (i = 1; i <= k; i++) if (g[i] == $1) isign = 1
      if (!isreq && !isadv && !isign && $3 != "success" && $3 != "skipped" && $3 != "neutral") print $1 "=" $3
    }' <<<"$jobs")"
  if [ -n "$blocking" ]; then
    echo "red"
    return 0
  fi
  if [ -n "$cancelled" ]; then
    echo "pending"
    return 0
  fi
  echo "green"
}

# parse_merge_ref_status <statuses json> -> "<state><TAB><description>" of the
# last `automerge/merge-ref` status, empty when there is none. Pure.
parse_merge_ref_status() {
  jq -r --arg ctx "automerge/merge-ref" '
    ([.statuses[]? | select(.context == $ctx)] | sort_by(.created_at) | last)
    | if . == null then ""
      else ((.state // "unknown") + "\t" + (.description // ""))
      end' <<<"$1" 2>/dev/null || true
}

# merge_ref_verdict <status> <head sha> <main sha> <merge ref sha> <ref current 0|1>
#   -> green | stale | red | none
# Pure. `status` is "<state><TAB><description>" (see parse_merge_ref_status).
# The verdict is about the commit the run actually tested: the current form
# `head <head> main <main>` (ci.yml merges the PR head with main). The old
# form `merge ref <sha>` counts only when that GitHub merge ref is built on
# the current main. A verdict about another head or main is stale: it asks
# for a new run, it never merges. Red counts only for the current head and
# main, so an old red verdict does not hold the gate back.
merge_ref_verdict() {
  local status="$1" head_sha="$2" main_sha="$3" ref_sha="$4" ref_current="$5"
  local state desc current=0
  local re_head='^head ([0-9a-f]+) main ([0-9a-f]+)$' re_ref='^merge ref ([0-9a-f]+)$'
  [ -n "$status" ] || { echo "none"; return 0; }
  state="${status%%$'\t'*}"
  desc="${status#*$'\t'}"
  if [[ "$desc" =~ $re_head ]]; then
    if [ "${BASH_REMATCH[1]}" = "$head_sha" ] && [ "${BASH_REMATCH[2]}" = "$main_sha" ]; then
      current=1
    fi
  elif [[ "$desc" =~ $re_ref ]]; then
    if [ "$ref_current" = "1" ] && [ "${BASH_REMATCH[1]}" = "$ref_sha" ]; then
      current=1
    fi
  else
    echo "stale"
    return 0
  fi
  case "$state" in
    success) if [ "$current" = 1 ]; then echo "green"; else echo "stale"; fi ;;
    failure | error) if [ "$current" = 1 ]; then echo "red"; else echo "stale"; fi ;;
    *) echo "none" ;;
  esac
}

# merge_ref_status <head_sha> -> the `automerge/merge-ref` status of that
# commit. The status is written by the CI workflow when the sweep dispatches
# the gate for a PR (a push with the GITHUB_TOKEN triggers no workflow run,
# so the sweep has to ask for the run itself; docs/auto-merge.md §5).
merge_ref_status() {
  local head_sha="$1"
  parse_merge_ref_status "$(gh api "repos/$REPO/commits/$head_sha/status?per_page=100" 2>/dev/null || echo '{}')"
}

# drop_merge_ref_checks <check-runs json> <runs json> -> the check-runs of a
# commit without those of the runs dispatched for a PR merge ref. Pure.
# A dispatch for a PR merge ref is attached to the head of `main`, so its
# `gate` would otherwise count as the verdict about `main` (a PR's red gate
# then holds `main` red for the whole sweep). Those runs are named
# `CI [merge-ref #<n>]` (ci.yml run-name).
drop_merge_ref_checks() {
  # The check-runs of a busy `main` are too large for a command-line
  # argument (jq: "Argument list too long"), so the JSON goes through files.
  local checks_file runs_file out
  checks_file="$(mktemp)"
  runs_file="$(mktemp)"
  printf '%s' "$1" >"$checks_file"
  printf '%s' "$2" >"$runs_file"
  out="$(jq -c -n --slurpfile checks "$checks_file" --slurpfile runs "$runs_file" '
    ([$runs[0].workflow_runs[]?
      | select(.event == "workflow_dispatch"
               and ((.display_title // "") | startswith("CI [merge-ref #")))
      | .check_suite_id]) as $skip
    | {check_runs: [$checks[0].check_runs[]?
        | select(.check_suite.id as $s | any($skip[]; . == $s) | not)]}')"
  rm -f "$checks_file" "$runs_file"
  printf '%s\n' "$out"
}

# commit_gate_state <sha> -> green | pending | red | missing
# The verdict of the CI jobs that ran against that commit. When a job ran
# more than once (a push run and a dispatched run), the newest run counts.
# The check-runs of a commit carry the jobs of every workflow that ran on
# it, so the ignored jobs (the sweep's own job) are dropped here: they are
# not gate jobs and they must not decide the verdict about `main`. The runs
# dispatched for a PR merge ref are dropped too (drop_merge_ref_checks).
commit_gate_state() {
  local sha="$1" checks runs jobs
  checks="$(gh api "repos/$REPO/commits/$sha/check-runs?per_page=100" 2>/dev/null)" || checks='{"check_runs":[]}'
  runs="$(gh api "repos/$REPO/actions/runs?head_sha=$sha&per_page=100" 2>/dev/null)" || runs='{"workflow_runs":[]}'
  jobs="$(drop_merge_ref_checks "$checks" "$runs" \
    | jq -r '[.check_runs[] | {name, status, conclusion, started_at}]
             | group_by(.name) | map(sort_by(.started_at) | last)
             | .[] | [.name, .status, (.conclusion // "none")] | @tsv' 2>/dev/null || true)"
  classify_jobs "$jobs" "$IGNORED_CHECKS"
}

# ci_run_jobs_state <run_id> -> green | pending | red | missing
ci_run_jobs_state() {
  local run_id="$1" jobs
  jobs="$(gh api "repos/$REPO/actions/runs/$run_id/jobs?per_page=100" \
    --jq '.jobs[] | [.name, .status, (.conclusion // "none")] | @tsv' 2>/dev/null || true)"
  classify_jobs "$jobs"
}

# pr_touches_blocked_path <number> -> 0 when the PR changes the merge gate
# itself (the workflow or the sweep script), 1 when it does not, 2 when the
# PR's changed files could not be read. Such a PR is never auto-merged:
# a change must not be able to edit its own gate. The check fails closed
# (issue #1280): a broken `gh` must not look like "touches nothing" - a PR
# that claims to be clean without a readable file list is skipped, not
# merged. With an empty blocked-path list there is nothing to read, so the
# check cannot fail and the call is answered without touching `gh`.
pr_touches_blocked_path() {
  local number="$1" path files
  if [ -z "$BLOCKED_PATHS" ]; then
    return 1
  fi
  if ! files="$(gh pr view "$number" --repo "$REPO" --json files --jq '.files[].path' 2>/dev/null)"; then
    return 2
  fi
  local IFS=','
  for path in $BLOCKED_PATHS; do
    path="$(echo "$path" | tr -d '[:space:]')"
    [ -n "$path" ] || continue
    if echo "$files" | grep -q "^$path"; then
      return 0
    fi
  done
  return 1
}

# main_is_green -> 0 when the CI gate on the current main commit is green
main_is_green() {
  local state
  refresh_main_sha
  if [ -z "$MAIN_SHA" ]; then
    # An unreadable `main` is a broken sweep, not a red `main`.
    fail "could not read the head of main"
  fi
  state="$(commit_gate_state "$MAIN_SHA")"
  log "main gate ($MAIN_SHA): $state"
  [ "$state" = "green" ]
}

# active_gate_for_pr <number> <head sha> -> 0 when a gate for that PR is
# queued or running: a native CI run on the PR head, or a dispatched
# `CI [merge-ref #<n>]` run. Only the CI workflow counts. Any run on the
# `main` commit used to count, and the sweep's own job and the advisory live
# lane always run there, so a PR whose verdict went stale was never
# dispatched again.
active_gate_for_pr() {
  local number="$1" head_sha="$2" st n
  for st in in_progress queued; do
    n="$(gh api "repos/$REPO/actions/workflows/$CI_WORKFLOW/runs?head_sha=$head_sha&status=$st&per_page=50" \
      --jq '.workflow_runs | length' 2>/dev/null || echo 0)"
    [ "${n:-0}" != "0" ] && return 0
    n="$(gh api "repos/$REPO/actions/workflows/$CI_WORKFLOW/runs?event=workflow_dispatch&status=$st&per_page=50" \
      --jq "[.workflow_runs[] | select(.display_title == \"CI [merge-ref #$number]\")] | length" 2>/dev/null || echo 0)"
    [ "${n:-0}" != "0" ] && return 0
  done
  return 1
}

# dispatch_ci <ref> -> 0 when the CI workflow was dispatched for that ref.
# A dry run only logs what it would do.
dispatch_ci() {
  local ref="$1"
  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run: would dispatch $CI_WORKFLOW for $ref"
    return 0
  fi
  if gh workflow run "$CI_WORKFLOW" --repo "$REPO" --ref "$ref" >/dev/null 2>&1; then
    log "dispatched $CI_WORKFLOW for $ref"
    return 0
  fi
  log "WARNING: could not dispatch $CI_WORKFLOW for $ref (the API may refuse that ref)"
  return 1
}

# dispatch_ci_for_pr <number> <main sha> -> 0 when the gate was dispatched for
# the PR head merged with that main commit. The run does not depend on GitHub's
# merge ref, which is not rebuilt when `main` moves: ci.yml checks out the PR
# head, merges <main sha> into it, and reports the verdict as the commit status
# `automerge/merge-ref` on the head commit, described `head <head> main <main>`.
# The run itself belongs to `main` (a dispatch cannot target a PR head + main
# merge: the API answers "No ref found" for refs/pull/<n>/merge).
dispatch_ci_for_pr() {
  local number="$1" main="$2"
  if [ -z "$main" ]; then
    log "WARNING: no main commit to dispatch PR #$number against"
    return 1
  fi
  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run: would dispatch $CI_WORKFLOW for PR #$number on main $main"
    return 0
  fi
  if gh workflow run "$CI_WORKFLOW" --repo "$REPO" --ref "$BASE_BRANCH" \
    -f "pr_number=$number" -f "main_sha=$main" >/dev/null 2>&1; then
    log "dispatched $CI_WORKFLOW for PR #$number on main $main"
    return 0
  fi
  log "WARNING: could not dispatch $CI_WORKFLOW for PR #$number"
  return 1
}

list_open_prs() {
  gh pr list --repo "$REPO" --state open --base "$BASE_BRANCH" --limit 100 \
    --json number,title,isDraft,labels,headRefName,headRefOid,author,url
}

# decide_pr <pr-json> -> "<decision>|<detail>"
decide_pr() {
  local pr="$1"
  local number draft labels state mergeable merge_state head_sha ref_sha run_id job_state legacy
  local ref_current tested_ref verdict
  local gate_detail="" verdict=""
  number="$(jq -r '.number' <<<"$pr")"
  draft="$(jq -r '.isDraft' <<<"$pr")"
  labels="$(jq -r '[.labels[].name] | join("\n")' <<<"$pr")"
  head_sha="$(jq -r '.headRefOid' <<<"$pr")"

  if [ "$draft" = "true" ]; then
    echo "skip|draft"
    return 0
  fi
  if has_block_label "$labels"; then
    echo "skip|block label"
    return 0
  fi
  # Fail closed: an unreadable file list must not look like "touches no
  # blocked path" (issue #1280). Statuses: 0 = touches, 1 = clean, 2 = unread.
  # The initial value must be 0: `cmd || var=$?` only assigns on failure,
  # so a successful call (the PR touches the gate) would otherwise keep the
  # initializer and fall through unskipped.
  local blocked_status=0
  pr_touches_blocked_path "$number" || blocked_status=$?
  case "$blocked_status" in
    0)
      echo "skip|the PR changes the merge gate itself"
      return 0
      ;;
    2)
      echo "skip|could not read the PR's changed files"
      return 0
      ;;
  esac

  state="$(pr_merge_state "$number")"
  mergeable="${state%%|*}"
  merge_state="${state##*|}"
  case "$mergeable" in
    false)
      echo "skip|conflict with main"
      return 0
      ;;
    unknown)
      echo "skip|mergeability unknown (GitHub is still computing it)"
      return 0
      ;;
  esac
  case "$merge_state" in
    dirty)
      echo "skip|conflict with main"
      return 0
      ;;
    blocked)
      echo "skip|blocked by the repository rules"
      return 0
      ;;
    # `unstable` (a check of the head is red) is deliberately not a skip. A
    # red native run of the head may have tested an older `main`, and it
    # decides nothing about the current merge ref: the gate verdict below
    # decides, not this field.
  esac

  ref_sha="$(merge_ref_sha "$number")"
  if [ -z "$ref_sha" ]; then
    echo "skip|no merge ref (the branch conflicts with main)"
    return 0
  fi

  # GitHub's merge ref is not rebuilt when `main` moves, so it is trusted only
  # when it is built on the current main. Nothing else depends on it: the
  # dispatched gate tests the PR head merged with the current main itself.
  ref_current=0
  if merge_ref_is_current "$ref_sha"; then
    ref_current=1
  fi
  if [ -z "$MAIN_SHA" ]; then
    echo "skip|could not read the head of main"
    return 0
  fi

  if [ "$ref_current" = 1 ]; then tested_ref="$ref_sha"; else tested_ref=""; fi
  run_id="$(fresh_ci_run "$head_sha" "$tested_ref")"
  local gate_detail=""
  if [ -z "$run_id" ]; then
    # No native CI run tested this head against the current main (a green run
    # on the head against an older main does not count). The verdict is the
    # `automerge/merge-ref` status about this head and this main. Without a
    # current one the sweep dispatches the gate for them and merges on a later
    # sweep, once the verdict is in.
    verdict="$(merge_ref_verdict "$(merge_ref_status "$head_sha")" \
      "$head_sha" "$MAIN_SHA" "$ref_sha" "$ref_current")"
    case "$verdict" in
      green) gate_detail="the dispatched gate is green on head $head_sha and main $MAIN_SHA" ;;
      none | stale)
        if active_gate_for_pr "$number" "$head_sha"; then
          echo "skip|CI is still running"
          return 0
        fi
        if [ "$DRY_RUN" = "true" ]; then
          echo "skip|dry run: would dispatch the gate on head $head_sha and main $MAIN_SHA"
          return 0
        fi
        dispatch_ci_for_pr "$number" "$MAIN_SHA" || true
        echo "skip|dispatched the gate on head $head_sha and main $MAIN_SHA; a later sweep merges"
        return 0
        ;;
      red)
        echo "skip|the dispatched gate is red"
        return 0
        ;;
    esac
  else
    job_state="$(ci_run_jobs_state "$run_id")"
    case "$job_state" in
      green) gate_detail="CI run $run_id is green on the current main" ;;
      pending)
        echo "skip|CI is still running"
        return 0
        ;;
      red)
        echo "skip|CI is red"
        return 0
        ;;
      *)
        echo "skip|no CI gate on this commit"
        return 0
        ;;
    esac
  fi

  legacy="$(gh api "repos/$REPO/commits/$head_sha/status" 2>/dev/null \
    | jq -r 'if (.total_count // 0) == 0 then "none" else (.state // "unknown") end')"
  case "$legacy" in
    none | success) ;;
    *)
      echo "skip|legacy commit status is $legacy"
      return 0
      ;;
  esac

  # Re-verify right before the merge: the head or the base may have moved
  # while the sweep was running.
  local current_head current_main
  current_head="$(gh api "repos/$REPO/pulls/$number" --jq '.head.sha' 2>/dev/null || true)"
  current_main="$(gh api "repos/$REPO/commits/${BASE_BRANCH}" --jq '.sha' 2>/dev/null || true)"
  if [ "$current_head" != "$head_sha" ] || [ "$current_main" != "$MAIN_SHA" ]; then
    echo "skip|the PR moved while the sweep ran"
    return 0
  fi

  echo "merge|$gate_detail"
}

merge_pr() {
  local number="$1"
  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run: would merge #$number"
    return 0
  fi
  if gh pr merge "$number" --repo "$REPO" --"$MERGE_METHOD" >/dev/null 2>&1; then
    log "merged #$number"
    cleanup_issue_labels "$number"
    return 0
  fi
  log "WARNING: the merge of #$number failed"
  return 1
}

# cleanup_issue_labels drops the agent labels from the issue the merged PR
# closes. The PR closes the issue through `Closes #<n>`; the labels are the
# orchestrator's bookkeeping and MUST NOT outlive the merge.
cleanup_issue_labels() {
  local number="$1" body issue
  body="$(gh pr view "$number" --repo "$REPO" --json body --jq '.body' 2>/dev/null || true)"
  [ -n "$body" ] || return 0
  while IFS= read -r issue; do
    [ -n "$issue" ] || continue
    gh issue edit "$issue" --repo "$REPO" \
      --remove-label "agent:in-progress" --remove-label "agent:needs-review" >/dev/null 2>&1 || true
    log "cleaned the agent labels of issue #$issue"
  done < <(grep -oiE '(closes|fixes|resolves)[[:space:]]+#[0-9]+' <<<"$body" | grep -oE '[0-9]+')
}

# refresh_ci_after_merges keeps the CI alive when the merge used the
# GITHUB_TOKEN: such a push triggers no workflow run at all. It also runs
# when nothing was merged: `main` may have moved without a sweep merge (a
# human push or merge), and then no PR has a run against the new `main`.
refresh_ci_after_merges() {
  [ "$TOKEN_SOURCE" = "bot" ] || return 0
  [ "$DISPATCH_CI" = "never" ] && return 0

  if [ "$MERGED_COUNT" -gt 0 ]; then
    log "the merge used the GITHUB_TOKEN: re-dispatching the CI by hand"
    dispatch_ci "$BASE_BRANCH" || true
  fi

  local prs pr number head_sha ref_sha state verdict mstate mergeable labels blocked_status
  local ref_current tested_ref
  prs="$(list_open_prs || echo '[]')"
  while IFS= read -r pr; do
    [ -n "$pr" ] || continue
    number="$(jq -r '.number' <<<"$pr")"
    if [ "$(jq -r '.isDraft' <<<"$pr")" = "true" ]; then
      continue
    fi
    case "$DISPATCHED_PRS" in
      *" $number "*) continue ;;
    esac
    # The same skips as decide_pr: a block label, or a change to the gate.
    # A PR whose changed files cannot be read is skipped (fail closed).
    labels="$(jq -r '[.labels[].name] | join("\n")' <<<"$pr")"
    if has_block_label "$labels"; then
      continue
    fi
    blocked_status=0
    pr_touches_blocked_path "$number" || blocked_status=$?
    [ "$blocked_status" -eq 1 ] || continue
    mstate="$(pr_merge_state "$number")"
    mergeable="${mstate%%|*}"
    if [ "$mergeable" = "false" ] || [ "${mstate##*|}" = "dirty" ]; then
      continue
    fi
    head_sha="$(jq -r '.headRefOid' <<<"$pr")"
    ref_sha="$(merge_ref_sha "$number")"
    [ -n "$ref_sha" ] || continue
    ref_current=0
    if merge_ref_is_current "$ref_sha"; then
      ref_current=1
    fi
    if [ "$ref_current" = 1 ]; then tested_ref="$ref_sha"; else tested_ref=""; fi
    state="$(ci_run_jobs_state "$(fresh_ci_run "$head_sha" "$tested_ref")")"
    [ "$state" = "green" ] && continue
    verdict="$(merge_ref_verdict "$(merge_ref_status "$head_sha")" \
      "$head_sha" "$MAIN_SHA" "$ref_sha" "$ref_current")"
    case "$verdict" in
      # A green verdict on this head and main is waiting for the merge. A red
      # one is not re-dispatched by its own completion: the sweep wakes on
      # every CI completion and a dispatched gate IS a CI run, so a red dispatch
      # would re-dispatch itself until it went green (issue #1267),
      # each cycle occupying the single self-hosted runner. A fresh verdict
      # for a red PR comes from the other triggers (a `main` push, the PR
      # updated, a manual sweep) - not from the failure itself.
      green | red) continue ;;
    esac
    if active_gate_for_pr "$number" "$head_sha"; then
      log "#$number already has a running CI run"
      continue
    fi
    dispatch_ci_for_pr "$number" "$MAIN_SHA" || true
  done < <(jq -c '.[]' <<<"$prs")
}

# log_decision <pr number> <decision> <detail> -> one line per PR in the run
# log, so `gh run view --log` shows why a PR was merged or skipped.
log_decision() {
  log "#$1 $2: $3"
}

# sweep_status_comment <pr json> <reason> - keeps ONE comment per skipped PR,
# carrying the current skip reason. The comment is found by its hidden marker
# and edited only when the reason changed. Never in a dry run, never on a draft.
sweep_status_comment() {
  local pr="$1" reason="$2" number body existing id
  number="$(jq -r '.number' <<<"$pr")"
  [ "$DRY_RUN" = "true" ] && return 0
  [ "$(jq -r '.isDraft' <<<"$pr")" = "true" ] && return 0
  body="$(printf '%s\nThe CI auto-merge sweep skipped this pull request: %s.' \
    '<!-- automerge-sweep-status -->' "$reason")"
  existing="$(gh api "repos/$REPO/issues/$number/comments?per_page=100" --paginate \
    --jq '.[] | select((.body // "") | contains("<!-- automerge-sweep-status -->")) | tojson' \
    2>/dev/null | tail -n 1 || true)"
  if [ -z "$existing" ]; then
    gh api -X POST "repos/$REPO/issues/$number/comments" -f body="$body" >/dev/null 2>&1 \
      || log "WARNING: could not comment the skip reason on #$number"
    return 0
  fi
  id="$(jq -r '.id' <<<"$existing")"
  if [ "$(jq -r '.body' <<<"$existing")" = "$body" ]; then
    return 0
  fi
  gh api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$body" >/dev/null 2>&1 \
    || log "WARNING: could not update the status comment on #$number"
}

main() {
  validate_config
  log "sweep start: repo=$REPO token=$TOKEN_SOURCE method=$MERGE_METHOD dry_run=$DRY_RUN"
  preflight

  if [ "$REQUIRE_MAIN_GREEN" = "true" ] && ! main_is_green; then
    log "main is not green: no PR is merged in this run"
    printf '::warning::main is not green: the sweep merged nothing\n'
    add_row "-" "-" "skipped" "main is not green"
    write_summary
    exit 0
  fi

  # The merge-ref freshness check compares against `main`, which the green
  # check above may not have read (REQUIRE_MAIN_GREEN=false).
  refresh_main_sha

  local prs pr number title decision detail
  prs="$(list_open_prs)"
  while IFS= read -r pr; do
    [ -n "$pr" ] || continue
    number="$(jq -r '.number' <<<"$pr")"
    title="$(jq -r '.title' <<<"$pr")"
    decision="$(decide_pr "$pr")"
    detail="${decision#*|}"
    decision="${decision%%|*}"
    log_decision "$number" "$decision" "$detail"
    case "$detail" in
      "dispatched the gate"*) DISPATCHED_PRS="${DISPATCHED_PRS}${number} " ;;
    esac
    case "$decision" in
      merge)
        if merge_pr "$number"; then
          add_row "#$number" "$title" "$([ "$DRY_RUN" = "true" ] && echo would-merge || echo merged)" "$detail"
          if [ "$DRY_RUN" != "true" ]; then
            gh pr comment "$number" --repo "$REPO" --body \
              "Auto-merged by the CI sweep: the \`gate\` job is green on the current \`main\` and the branch has no conflict with it." \
              >/dev/null 2>&1 || true
          fi
          # `main` moved: every other PR must be verified against the new one.
          refresh_main_sha
        else
          add_row "#$number" "$title" "failed" "$detail"
        fi
        ;;
      error)
        add_row "#$number" "$title" "failed" "$detail"
        ;;
      *)
        add_row "#$number" "$title" "skipped" "$detail"
        sweep_status_comment "$pr" "$detail"
        ;;
    esac
  done < <(jq -c '.[]' <<<"$prs")

  refresh_ci_after_merges

  log "sweep done: merged=$MERGED_COUNT skipped=$SKIPPED_COUNT failed=$FAILED_COUNT"
  write_summary
  if [ "$FAILED_COUNT" -gt 0 ]; then
    fail "$FAILED_COUNT pull request(s) could not be processed (see the summary)"
  fi
}

# Sourcing the script (the self test does) must not run the sweep.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi