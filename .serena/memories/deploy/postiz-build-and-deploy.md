# Postiz (social.pen-pixel.hu) - build and deploy runbook

Written 2026-11-14. Verify paths/versions before relying on them.

## Layout (Mac mini, Rancher Desktop / moby)
- Deploy dir: `/Users/kissp/srv/postiz` -> `compose.yml`, `.env` (600, secrets, never commit), `aiven-ca.pem`.
- Source: `/Users/kissp/srv/postiz/src` is NOT a git repo. It is an extract of this fork
  (`KissPeter/postiz-app`, branch `kisspeter/v2.11.0`). Re-sync it from the branch before building.
- Image tag in `compose.yml`: `postiz-app:v2.11.0-kpN` (kp2 = folders/UI/delayed comments, kp3 = + PR #19 + notification email override).
- Public path: autossh reverse tunnel VPS 127.0.0.1:8120 -> Mac 127.0.0.1:5055 -> container :5000.
- DB: Aiven Postgres (db `postiz`), Redis: `fundvista-redis` db 5, uploads on Cloudflare R2.

## Build
```bash
cd /Users/kissp/srv/postiz/src
export DOCKER_CONFIG=/Users/kissp/srv/postiz/dockercfg   # see gotcha 6; unset before docker compose
docker build --memory=5500m --memory-swap=5500m -f Dockerfile.dev \
  -t postiz-app:v2.11.0-kp3 . > ../build-kp3.log 2>&1; echo BUILD_EXIT=$? >> ../build-kp3.log
```
Run it in the background; 5-10 min. Success = `BUILD_EXIT=0` and the image in `docker images`.

### Gotchas
1. **Memory**: Rancher VM is 8 GB (`virtualMachine.memoryInGB` in
   `~/Library/Preferences/rancher-desktop/settings.json`), no swap. `next build` OOMs at a 5 GB cap with
   everything running. Free memory first: stop idle `gha-runner-1..5` (`docker top <c> | grep Runner.Worker`
   must be empty) and `postiz` itself (site down during the build; acceptable); restart them afterwards.
   `rdctl set --virtual-machine.memory-in-gb 10` restarts the VM and Rancher Desktop then had to be reopened by
   hand from the desktop (`open -a` fails from the Claude session with a launchd domain error). The VM crashed
   once after that change; the setting is back at 8.
2. **Google Fonts**: Google now answers next/font with extension-less URLs
   (`fonts.gstatic.com/l/font?kit=...`), crashing Next 14.2.35 (`TypeError ... reading '1'` in
   `@next/font/.../loader.js`). `Dockerfile.dev` runs `node var/docker/patch-next-font.js` after `pnpm install`.
3. **Sourcemaps**: `Dockerfile.dev` seds `apps/frontend/next.config.js` to disable production sourcemaps
   (`productionBrowserSourceMaps: false`, `config.devtool = false`) to cut build memory. Cost: unreadable
   production stack traces. Remove that RUN line if more RAM is available.
4. A macOS host build only verifies compilation; it cannot produce the Alpine image (needs Node 22.20 +
   pnpm 10.6.1).
5. **Disk full (happened 2026-11-14)**: the Rancher VM disk (`~/Library/Application Support/rancher-desktop/lima/0/disk`,
   sparse, grew to 84 GB) filled the Mac's data volume; the VM's ext4 went `emergency_ro` and containers could not
   start. Fix: free some host space, then `rdctl api -X PUT /v1/backend_state -b '{"vmState":"STOPPED"}'` followed by
   `'{"vmState":"STARTED"}'` (restarts the VM without the GUI), start the CI runners (stopped containers get pruned!
   `docker start gha-runner-1..5` BEFORE any `docker container prune`), then `docker container prune -f`,
   `docker image prune -a -f`, `docker builder prune -af`, and `rdctl shell sudo fstrim -v /var/lib` to give the
   space back to macOS (84 GB -> 38 GB). Check `docker system df` and `df -h /System/Volumes/Data` after each build.
6. **Keychain / base image pulls**: after a prune the base image `node:22.20-alpine` must be pulled again, and the
   osxkeychain credential helper fails in the Claude session. Use the credential-free config
   `export DOCKER_CONFIG=/Users/kissp/srv/postiz/dockercfg` for `docker pull`/`docker build` only. Do NOT keep it for
   `docker compose` (the compose plugin is not found under that config; unset it first).

## Local settings / patches
- `NOTIFICATION_EMAIL_TO` env in `compose.yml` (currently `pen.pixel.hu@gmail.com`): all org notification and digest
  emails go there instead of each member's own email (`notification.service.ts`, `notificationEmailOverride()`);
  invites, activation and password resets are unaffected; per-user success/failure preferences are bypassed.
- Calendar week view limited to 08:00-20:00, timezone picker enabled (PR #19). Timezone defaults to the browser's;
  only a choice in Settings (stored in localStorage) makes posts and the calendar grid disagree.

## Deploy
1. Edit `compose.yml`: `image: postiz-app:v2.11.0-kp3` (keep a `.bak` copy; keep the previous image for rollback).
2. `unset DOCKER_CONFIG; cd /Users/kissp/srv/postiz && docker compose up -d postiz`
3. Startup runs `pm2 delete all; prisma db push; pm2 ...` (package.json `pm2-run`). `db push` is additive
   here (media-folder tables, `Post.delay` default 0); it refuses destructive changes.
4. Verify: `docker logs --tail 50 postiz`; `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5055/`
   (502 for ~1 min while starting, then 307) and the same for `https://social.pen-pixel.hu/`.
5. UI checks: media library (folders, sort, bulk select, filename strip); post editor "Publish this comment
   after" dropdown on the 2nd+ thread item (Facebook/Instagram channels only, 1-30 minutes).
6. Restart stopped CI runners: `docker start gha-runner-1 gha-runner-2 gha-runner-3 gha-runner-4 gha-runner-5`.

## Rollback
Set `image:` back to the previous tag (kp2; kp1 was pruned) and `docker compose up -d postiz`. The new DB
table/column are harmless to older images.
