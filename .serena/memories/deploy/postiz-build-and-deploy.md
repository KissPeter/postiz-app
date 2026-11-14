# Postiz (social.pen-pixel.hu) - build and deploy runbook

Written 2026-11-14. Verify paths/versions before relying on them.

## Layout (Mac mini, Rancher Desktop / moby)
- Deploy dir: `/Users/kissp/srv/postiz` -> `compose.yml`, `.env` (600, secrets, never commit), `aiven-ca.pem`.
- Source: `/Users/kissp/srv/postiz/src` is NOT a git repo. It is an extract of this fork
  (`KissPeter/postiz-app`, branch `kisspeter/v2.11.0`).
- Image tag in `compose.yml`: `postiz-app:v2.11.0-kpN` (kp1 = old, kp2 = with folders/UI/delayed comments).
- Public path: autossh reverse tunnel VPS 127.0.0.1:8120 -> Mac 127.0.0.1:5055 -> container :5000.
- DB: Aiven Postgres (db `postiz`), Redis: `fundvista-redis` db 5, uploads on Cloudflare R2.

## Build
```bash
cd /Users/kissp/srv/postiz/src
docker build --memory=5500m --memory-swap=5500m -f Dockerfile.dev \
  -t postiz-app:v2.11.0-kp2 . > ../build-kp2.log 2>&1; echo BUILD_EXIT=$? >> ../build-kp2.log
```
Run it in the background; 5-10 min. Success = `BUILD_EXIT=0` and the image in `docker images`.

### Gotchas
1. **Memory**: Rancher VM is 8 GB (`virtualMachine.memoryInGB` in
   `~/Library/Preferences/rancher-desktop/settings.json`), no swap. `next build` OOMs at a 5 GB cap with
   everything running. Free memory first: stop idle `gha-runner-1..5` (`docker top <c> | grep Runner.Worker`
   must be empty) and, if needed, `postiz` itself; restart them afterwards. The kp2 build succeeded with
   `--max-old-space-size=3072` (local Dockerfile) at a 5.5 GB cap; the repo Dockerfile says 4096.
   `rdctl set --virtual-machine.memory-in-gb 10` restarts the VM; Rancher Desktop then had to be reopened by
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

## Deploy
1. Edit `compose.yml`: `image: postiz-app:v2.11.0-kp2` (keep a backup; keep the old image for rollback).
2. `cd /Users/kissp/srv/postiz && docker compose up -d postiz`
3. Startup runs `pm2 delete all; prisma db push; pm2 ...`. `db push` is additive here (media-folder tables,
   `Post.delay` default 0) and refuses destructive changes.
4. Verify: `docker logs --tail 50 postiz`; `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5055/`
   (502 for ~1 min while starting, then 307) and the same for `https://social.pen-pixel.hu/`.
5. UI checks: media library (folders, sort, bulk select, filename strip); post editor "Publish this comment
   after" dropdown on the 2nd+ thread item (Facebook/Instagram channels only, 1-30 minutes).
6. Restart stopped CI runners: `docker start gha-runner-1 gha-runner-2 gha-runner-3 gha-runner-4 gha-runner-5`.

## Rollback
Set `image:` back to `postiz-app:v2.11.0-kp1` and `docker compose up -d postiz`. The new DB table/column are
harmless to the old image.
