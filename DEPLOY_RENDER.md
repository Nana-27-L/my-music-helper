# Deploy SingMyKey To Render (Free Plan)

## Why this route

This repo now includes:

- `render.yaml` (Render Blueprint config)
- `Dockerfile.render-free` (lighter image for free plan)

The free Dockerfile does **not** install Demucs/Spleeter. That means:

- app can still run end-to-end on mobile browser
- `/api/process-song` falls back to direct full-song pitch shift when stem separation is unavailable

## 0. Push code to GitHub

From project root:

```bash
git add render.yaml Dockerfile.render-free backend/app/api/routes/audio.py DEPLOY_RENDER.md
git commit -m "add Render free deployment blueprint"
git push
```

## 1. Create Render service from Blueprint

1. Open Render Dashboard: `https://dashboard.render.com`
2. Click `New` -> `Blueprint`
3. Select your GitHub repo
4. Render detects `render.yaml` automatically
5. Confirm service plan is `free`
6. Click `Apply`

## 2. Wait for first deploy

- First build can take several minutes.
- When deploy is healthy, open:
  - `https://<your-service>.onrender.com/`
  - `https://<your-service>.onrender.com/api/health`

Expected health response:

```json
{"status":"ok"}
```

## 3. Mobile usage

1. Open the Render URL in phone browser (HTTPS)
2. Do one vocal range test and save profile
3. Upload MP3 and process
4. Record and export

## Free plan notes (important)

According to Render docs (checked on 2026-04-19):

- idle 15 minutes -> service spins down
- spin-up can take about 1 minute
- free web service file system is ephemeral
- free web services cannot attach persistent disks
- 750 free instance hours per workspace per month

So if service restarts/spins down/redeploys, server-side local profile files may be lost.

## Optional next upgrade

If you later want automatic vocal/accompaniment separation quality:

1. switch Render service to use root `Dockerfile` (full dependencies)
2. move from free plan to paid plan for better CPU/RAM stability
