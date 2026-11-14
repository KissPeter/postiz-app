# Postiz (social.pen-pixel.hu) - build and deploy runbook

Written 2026-11-14. Verify paths/versions before relying on them.

## Layout (Mac mini, Rancher Desktop / moby)
- Deploy dir: `/Users/kissp/srv/postiz` -> `compose.yml`, `.env` (600, secrets, never commit), `aiven-ca.pem`.
- Source: `/Users/kissp/srv/postiz/src` is NOT a git repo. It is an extract of the fork
  `KissPeter/postiz-app`, branch `kisspeter/v2.11.0` (tarball backup: `src-20becf2b.tgz`).
  PRs (merged into that branch, see GitHub): #1 filenames, #2 media library UI,
  #4 media folders, #14 delayed FB/IG comments, security PRs #7-#13, #17 storage URL fix.
- Image tag in `compose.yml`: `postiz-app:v2.11.0-kpN` (kp1 = old, kp2 = with folders/UI/delayed comments).
- Public path: autossh reverse tunnel VPS 127.0.0.1:8120 -> Mac 127.0.0.1:5055 -> container :5000.
- DB: Aiven Postgres (db `postiz`), Redis: `fundvista-redis` db 5, uploads on Cloudflare R2.

## Build
```bash
cd /Users/kissp/srv/postiz/src
docker build --memory=5500m --memory-swap=5500m -f Dockerfile.dev \
  -t postiz-app:v2.11.0-kp2 . > ../build-kp2.log 2>&1; echo BUILD_EXIT=$? >> ../build-kp2.log
```
Run it in the background; it takes 5-10 min. Success = `BUILD_EXIT=0` and the image listed in `docker images`.

### Gotchas (learned the hard way)
1. **Memory**: Rancher VM is 8 GB (`virtualMachine.memoryInGB` in
   `~/Library/Preferences/rancher-desktop/settings.json`), no swap. `next build` OOMs at a 5 GB cap
   with everything running. Free memory first: stop idle `gha-runner-1..5` (check `docker top <c> | grep Runner.Worker`
   is empty) and, if needed, `postiz` itself; restart them afterwards.
   `rdctl set --virtual-machine.memory-in-gb 10` restarts the VM, killed the Claude session, and Rancher
   Desktop then had to be reopened by hand from the desktop (it cannot be launched from the Claude session:
   `open -a` fails with a launchd domain error). VM crashed once right after that change; setting is back at 8.
2. **Google Fonts**: Google now answers next/font with extension-less URLs
   (`fonts.gstatic.com/l/font?kit=...`), crashing Next 14.2.35 (`TypeError ... reading '1'` in
   `@next/font/.../loader.js`). `Dockerfile.dev` runs `node var/docker/patch-next-font.js` after `pnpm install`
   to default the extension to woff2. Keep that line.
3. **Sourcemaps**: `Dockerfile.dev` also seds `apps/frontend/next.config.js` to turn off production
   sourcemaps (`productionBrowserSourceMaps: false`, `config.devtool = false`) to cut build memory.
   Consequence: unreadable production stack traces. Remove that RUN line if more RAM is available.
4. Host (macOS) builds only verify the code compiles; they cannot produce the Alpine image.
   Node 22.20 + pnpm 10.6.1 are needed (host has Node 26, no pnpm).

5. **Disk full (happened 2026-11-14)**: the Rancher VM disk (`~/Library/Application Support/rancher-desktop/lima/0/disk`,
   sparse, grew to 84 GB) filled the Mac's data volume; the VM's ext4 went `emergency_ro` and containers could not start.
   Fix: free some host space, then `rdctl api -X PUT /v1/backend_state -b '{"vmState":"STOPPED"}'` followed by
   `'{"vmState":"STARTED"}'` (restarts the VM without the GUI), start the CI runners (stopped containers get pruned!
   `docker start gha-runner-1..5` BEFORE any `docker container prune`), then `docker container prune -f`,
   `docker image prune -a -f`, `docker builder prune -af`, and `rdctl shell sudo fstrim -v /var/lib` to give the space
   back to macOS (84 GB -> 38 GB). Check `docker system df` and `df -h /System/Volumes/Data` after each build session.
6. **Keychain / base image pulls**: after a prune the base image `node:22.20-alpine` must be pulled again, and the
   osxkeychain credential helper fails in the Claude session. Use the credential-free config:
   `export DOCKER_CONFIG=/Users/kissp/srv/postiz/dockercfg` for `docker pull`/`docker build` only. Do NOT keep it for
   `docker compose` (the compose plugin is not found under that config; unset it first).
7. Free RAM for the build: `docker stop postiz gha-runner-1 gha-runner-2 gha-runner-3 gha-runner-4 gha-runner-5`
   (postiz is down during the build; the user accepted the outage).

## Local patches in the image (source = fork branch kisspeter/v2.11.0 + these)
- `NOTIFICATION_EMAIL_TO` env (compose.yml, currently `pen.pixel.hu@gmail.com`): all org notification and digest emails go
  there instead of each member's own email (`notification.service.ts`, `notificationEmailOverride()`); invites and
  password resets are unaffected. Committed to the fork (e710140).
- Calendar week view limited to 08:00-20:00, timezone picker enabled (PR #19). Timezone defaults to the browser's;
  only a choice in Settings (stored in localStorage) makes posts and calendar grid disagree.
- kp3 = kp2 + PR #19 + notification email override.
- kp4 = kp3 + original file names preserved (media library name comes from the uploaded file name; storage key
  stays random; existing files keep their hash names). Built 2026-11-14 with `--memory=6500m --memory-swap=6500m`
  (5500m was OOMKilled during the Next.js lint/type-check step). Rollback target is now kp3.
  Known nit: the kp4 image checks for the literal text "backslash-u-F-F-F-D" instead of the replacement character in
  `original.name.ts`, so a name that is genuinely Latin-1 (not UTF-8) would be shown garbled. Fixed in the fork
  and local source afterwards; picked up by the next rebuild (kp5).
- When pushing files to GitHub through the MCP `push_files`, backslash-u escapes in the content get turned into the
  literal characters; verify with `git hash-object <file>` against the blob SHA from `get_file_contents`.

## Deploy
1. Edit `compose.yml`: `image: postiz-app:v2.11.0-kp4` (current; keep a `.bak` copy; keep the old image for rollback).
2. `cd /Users/kissp/srv/postiz && docker compose up -d postiz`
3. Startup runs `pm2 delete all; prisma db push; pm2 ...` (package.json `pm2-run`). `db push` is additive
   here (new media-folder tables, `Post.delay` column default 0); it refuses destructive changes.
4. Verify: `docker logs --tail 50 postiz`, then
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5055/` (502 for ~1 min while starting, then 307)
   and the same for `https://social.pen-pixel.hu/`.
5. UI checks: Media library (folders, sort, bulk select, filename strip) and, in the post editor,
   the "Publish this comment after" dropdown on the 2nd+ thread item (only for Facebook/Instagram channels,
   1-30 minutes).
6. Restart stopped CI runners: `docker start gha-runner-1 gha-runner-2 gha-runner-3 gha-runner-4 gha-runner-5`.

## Rollback
Set `image:` back to `postiz-app:v2.11.0-kp3` (kp3 is the rollback target since kp4) and `docker compose up -d postiz`. The new DB table/column
are harmless to the old image.
