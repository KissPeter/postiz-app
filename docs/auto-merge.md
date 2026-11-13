# Auto-merge (the CI sweep)

Status: adopted 2026-10-22 (owner decision).

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD,
SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be
interpreted as described in RFC2119.

CI merges the pull requests. Nobody has to watch them.

## 1. What it is

`.github/workflows/auto-merge.yml` runs a sweep
(`.github/scripts/auto-merge-sweep.sh`) over the open pull requests and
merges every PR that is

1. not a draft,
2. not labeled `automerge:block` or `needs-human`,
3. mergeable with `main` without a conflict, and
4. covered by a **green CI gate that was tested against the current
   `main`** (see §4).

The merge is a **merge commit** (`gh pr merge --merge`), the same shape as
the existing `main` history. The branch is left in place.

This replaces the "CI-watch issue" loop of the issue orchestrator: no
follow-up ticket is created to track a CI run, and no agent merges a PR by
hand. `docs/definition-of-done.md` §5 and the orchestrator command
(`.opencode/commands/issue-orchestrator.md`) follow this rule.

## 2. When it runs

| Trigger | Why |
|---------|-----|
| `pull_request_target` (opened, synchronize, reopened, ready_for_review) | a new PR or a new push can turn another PR green |
| `workflow_run` on the `CI` workflow (completed) | the green verdict arrives here |
| `push` on `main` | a merge invalidates the merge refs of the other PRs |
| `workflow_dispatch` | a manual sweep (`dry_run` input: report only, merge nothing) |
| `schedule` (twice a day, 06:17 and 18:17 UTC) | a heartbeat: a CI run the sweep dispatched with the `GITHUB_TOKEN`, and a merge it made with it, fire no `workflow_run` or `push` event, so the sweep MUST NOT depend on those events to read the verdict of a gate it dispatched itself |

The `workflow_run` trigger watches the **`CI` workflow only** - the gate.
The advisory live lane lives in its own workflow (`ci-live.yml`), because
it runs for up to 90 minutes on `main`: with the live lane inside the `CI`
workflow, the sweep would wait for the advisory lane before it merged
anything.

The workflow always checks out `main` and always runs the script from
`main`. A pull request therefore cannot change the rules that merge it,
and the workflow file itself is reviewed as a normal change.

## 3. The merge rule

For every open PR the sweep asks GitHub for the current state and merges
the PR only when all of the following hold:

- `isDraft` is false.
- The labels do not contain `automerge:block` and do not contain
  `needs-human`.
- `mergeable` is true and `mergeable_state` is not `dirty` (conflict)
  and not `blocked`. `unstable` is not a skip: GitHub reports it whenever a
  check of the head is red, and a red native run may have tested an older
  `main`. The gate verdict below decides instead.
- A CI gate exists that tested the **current head commit** against the
  **current `main`** and is green. Two ways to have one:
  - the native one: a `pull_request` run of the `CI` workflow whose
    `base.sha` is the current `main`. GitHub does **not** start a new
    `pull_request` run when `main` moves, so a native run against an older
    `main` never counts and nothing replaces it by itself, or
  - the dispatched one: the sweep asked the `CI` workflow to test the PR
    head merged with the current `main` (§5). The run reports its verdict
    as the commit status `automerge/merge-ref` on the head commit of the PR,
    and the status names the head and the main it tested
    (`head <head> main <main>`).
  A native run that is red but tested an older `main` does not block: the
  sweep falls through to the dispatched verdict.
  In both cases the blocking job `gate` must be completed and successful.
  The other jobs must be successful, skipped or neutral. `live-e2e` is
  advisory (DoD §2) and never blocks a merge - not even while it runs.
  A **cancelled** `gate` run carries no verdict: the run was superseded or
  was stopped, so the gate has no verdict yet. The sweep does not call the
  pull request broken (`CI is red` is the word for a run that failed); it
  waits for a run with a verdict, the same way it waits for any pull
  request without a green CI. A job that really failed is red whatever
  else the run says - the order of the checks does not matter.
- The verdict is about the **current head commit** and the **current
  `main`**, as the status names them. GitHub's own merge ref
  (`refs/pull/<n>/merge`) is not used for the verdict: GitHub does not
  rebuild it when `main` moves, so it can stay built on an old `main` for
  good. A stale GitHub merge ref never blocks a PR; it only means that the
  sweep dispatches its own merge of the head with the current `main`.
- The legacy commit status of the head commit is not failing.
  In both cases the blocking job `gate` must be completed and successful.
  The other jobs must be successful, skipped or neutral. `live-e2e` is
  advisory (DoD §2) and never blocks a merge - not even while it runs.
  A **cancelled** `gate` run carries no verdict: the run was superseded or
  was stopped, so the gate has no verdict yet. The sweep does not call the
  pull request broken (`CI is red` is the word for a run that failed); it
  waits for a run with a verdict, the same way it waits for any pull
  request without a green CI. A job that really failed is red whatever
  else the run says - the order of the checks does not matter.
- The legacy commit status of the head commit is not failing.

Right before the merge the sweep re-reads the PR: if the head commit or the
merge ref moved while the sweep was running, the PR is skipped.

## 4. Why "green against the current main" and not just "green"

The `gate` job of a `pull_request` run tests the **merge result** (the
merge ref), not the branch alone. When `main` moves, every open PR gets a
new merge ref, and the old green result says nothing about the new one.
The sweep therefore compares the base SHA of the run with the current
`main` SHA and merges only a run that was tested against the current
`main`.

Consequence: **one PR is merged per CI cycle.** After a merge, `main`
moved, so the other PRs need a new CI run against the new `main` before
they can be merged. With a PAT, GitHub queues that run automatically; the
sweep merges the next PR when it comes back green. This is the behaviour
of a merge queue without the queue.

The sweep also refuses to merge anything while the `gate` job on the
current `main` is not green (`AUTOMERGE_REQUIRE_MAIN_GREEN`, default
`true`). A red `main` is never made worse by a new merge. Set the
repository variable `AUTOMERGE_REQUIRE_MAIN_GREEN=false` to turn the
guard off. The advisory `live-e2e` job does not count: it may still be
running (up to 90 minutes) while the gate is already green. A cancelled
`gate` on `main` is no verdict either, so it holds the sweep back the
same way a running one does.

The verdict about `main` comes from the check-runs of that commit, and
every workflow that ran on it has a job there: the `gate` (required), the
advisory `live-e2e`, and **the sweep's own job**. A run dispatched for a PR
merge ref (§5) is attached to the head of `main` too, so its `gate` would
appear there as well: those runs are named `CI [merge-ref #<n>]` and the
sweep drops their check-runs from the verdict (`drop_merge_ref_checks`). A
red PR gate therefore never holds `main` red. The sweep reads those
check-runs while its own job is running on that very commit, so its own
job must never decide the verdict - otherwise `main` is never green and
the sweep merges nothing.

The rule for a job that has not finished yet: it means "no verdict yet"
(`pending`) and holds the sweep back - unless the job is advisory
(`live-e2e` never blocks a merge) or ignored
(`AUTOMERGE_IGNORED_CHECKS`, default `sweep`). A job of an unknown
workflow that **failed** blocks the merge (`red`); a job of an unknown
workflow that is still running has no verdict yet either, so it holds the
sweep back (`pending`).

The ignore list decides nothing, it does not remove a job from the
verdict: a required check that the ignore list names is a configuration
error (the sweep refuses to start) and still holds the verdict back.
The list is for the commit-wide path only - the jobs of a single CI run
are gate jobs, and there nothing is ignored.

## 5. The token: `GITHUB_TOKEN` vs a PAT

A push made with the repository `GITHUB_TOKEN` triggers **no** workflow
run. That has two consequences:

- the `CI` run on `main` does not start after the sweep merges a PR, and
- the other PRs do not get their new CI run against the new `main`.

The sweep handles both by dispatching the `CI` workflow by hand whenever
it merged with the `GITHUB_TOKEN`. The `ci.yml` workflow therefore
carries a `workflow_dispatch` trigger with the input `pr_number`:

```sh
# the gate for main itself
gh workflow run ci.yml --ref main
# the gate for the head of a PR merged with a main commit
gh workflow run ci.yml --ref main -f pr_number=1174 -f main_sha=<main sha>
```

A dispatch **cannot** target a PR merge ref (`--ref refs/pull/1174/merge`
answers `No ref found`), and GitHub's merge ref is not rebuilt when `main`
moves. So the dispatched run checks out the PR head, merges `main_sha` into
it (a conflict fails the run), and reports the verdict it produced:

- the commit status `automerge/merge-ref` on the PR head, with the state
  (success/failure) and the head and the main it tested in the description:
  `head <head> main <main>`.

The sweep reads that status and merges the PR only when the status is green
**and** names the head and the main that are current now. A verdict about an
older head or an older main is stale: it is ignored, exactly like a stale CI
run, and the sweep dispatches the gate for the current head and main. The
sweep also still accepts the older form `merge ref <sha>`, but only while
that GitHub merge ref is built on the current `main`.

The refresh step after the merges applies the same skips as the merge
decision before it dispatches anything: a PR with a block label, and a PR
that touches a blocked path or whose changed files cannot be read, is never
dispatched.

**A red verdict dispatches no new run.** The sweep triggers on every
completion of the CI workflow and a merge-ref dispatch is itself a CI
run: a PR whose merge-ref gate came back red would re-dispatch itself
on every cycle, each cycle occupying the runner the real gates queue
behind (issue #1267). The sweep therefore holds the CI dispatch back
while the head commit carries a red `automerge/merge-ref` status for
the current head and main. A fresh verdict for such a PR is ordered by the
other triggers - `main` moved, the PR was updated, a manual sweep -
not by the red run's completion.

**Recommended:** add a repository secret `AUTOMERGE_TOKEN` (a PAT with
`contents: write` and `pull-requests: write`). With a PAT the push
triggers the workflows by themselves, the hand-made dispatch is not
needed, and the whole chain is native. The sweep uses
`secrets.AUTOMERGE_TOKEN` when it exists and falls back to
`secrets.GITHUB_TOKEN`.

## 6. Escape hatches

| Lever | Effect |
|-------|--------|
| label `automerge:block` | the PR is never auto-merged |
| label `needs-human` | the PR is never auto-merged |
| draft | the PR is never auto-merged |
| a PR that touches `.github/` (workflows or scripts) | the PR is never auto-merged (the gate may not edit itself); enforced by `AUTOMERGE_BLOCKED_PATHS: .github/` in the sweep job (issue #1271) |
| `workflow_dispatch` with `dry_run: true` | the sweep reports what it would merge and merges nothing |
| `AUTOMERGE_REQUIRE_MAIN_GREEN=false` (repository variable) | the sweep merges even when `main` is red |
| `AUTOMERGE_DISPATCH_CI=never` | the sweep never dispatches the CI by hand |
| `AUTOMERGE_MERGE_METHOD=squash\|rebase` | a different merge method |
| `AUTOMERGE_REQUIRED_CHECKS` / `AUTOMERGE_ADVISORY_CHECKS` | which CI jobs block a merge |
| `AUTOMERGE_IGNORED_CHECKS` | the jobs that never decide the verdict (default: `sweep`, the sweep's own job) |
| `AUTOMERGE_BLOCKED_PATHS` | the paths a PR may not touch to be auto-merged (the sweep job pins `.github/`, so a PR that edits the gate is never auto-merged; the script default without the env is empty) |

The blocked-path check **fails closed** (2026-10-27, issue #1280): when
`AUTOMERGE_BLOCKED_PATHS` is set and `gh` cannot read a PR's changed files,
the PR is skipped ("could not read the PR's changed files"), not merged -
an unreadable file list must never look like "touches no blocked path".
With no blocked paths configured there is nothing to read, so the check
cannot fail and no PR is skipped for it.

**The merge-risk tier does not gate the merge** (owner, 2026-10-22). The
sweep merges every open PR whose CI is green, whatever the tier of
`docs/merge-risk-scoring.md` says. The tier is advice for the author (how
careful to be, whether a direct push is allowed at all), not a brake on
the merge. The brake is the label: `automerge:block` and `needs-human`
are added by the owner, by hand, when a PR must not be merged
automatically.

## 7. What happens after a merge

A merge on `main` triggers the CD webhook (`docs/cd-webhook.md`): the
shop is deployed within ~2 minutes, **before** the `CI` run on `main`
can say anything. This is the same trade-off the owner accepted for the
T0/T1 direct pushes (`docs/merge-risk-scoring.md` §6). A red `gate` on
`main` after an auto-merge MUST be fixed forward or reverted with a
normal revert commit.

The sweep posts one comment on every PR it merges, so the history of a
merged PR shows that CI merged it and not a human. It also drops the
`agent:in-progress` and `agent:needs-review` labels from the issue the
merged PR closes (`Closes #<n>`): those labels are the orchestrator's
bookkeeping and MUST NOT outlive the merge.

## 8. Operating the sweep

```sh
# the self test of the decision logic (also a step of the `gate` job)
bash .github/scripts/auto-merge-sweep.test.sh

# a manual dry run: what would be merged right now?
gh workflow run auto-merge.yml --ref main -f dry_run=true
gh run list --workflow auto-merge.yml --limit 5

# the log of the last sweep
gh run view <run id> --log
```

The run summary lists every open PR with the decision and the reason.
The run log carries the same decision of every PR as one line,
`#<n> <decision>: <detail>`, so `gh run view --log` shows why a PR was
merged or skipped.

Each skipped PR also carries ONE sweep comment, found by its hidden marker
`<!-- automerge-sweep-status -->`, with the current skip reason. The sweep
edits that comment only when the reason changed and creates it otherwise.
It never comments in a dry run and never on a draft PR.

## 9. Verifying a change of the sweep itself

The API part of the sweep is verified against the real repository with a
dry run, which touches nothing:

```sh
GITHUB_REPOSITORY=KissPeter/pen-pixel-shop AUTOMERGE_DRY_RUN=true \
  bash .github/scripts/auto-merge-sweep.sh
```

The dry run prints the same table as the workflow and merges nothing. The
decision logic (job classification, block labels, configuration) is covered
by `.github/scripts/auto-merge-sweep.test.sh`, which runs in the `gate`
job of the `CI` workflow.

The script follows `docs/shell-script-conventions.md` - notably its
exit-status capture rule, whose violation in `decide_pr` let a
gate-editing PR through before #1280.

## 10. Safety of `pull_request_target`

The workflow runs on `pull_request_target`, so it has a write-capable
token. It MUST NOT execute any code from the pull request:

- the job checks out the **default branch**, never the PR head;
- the sweep script comes from `main`, so a PR cannot change the rules that
  merge it;
- the script only calls the GitHub API and `gh pr merge`; it never runs
  code, scripts or workflows from the PR.

The `pull_request_target` trigger is used on purpose: `pull_request` gives
a read-only token for PRs from forks, and the sweep could not merge
anything with it.
