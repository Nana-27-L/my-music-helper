# Deploy SingMyKey As An HTTPS Mobile Web App

This project is prepared for a single-service Railway deployment:

- Railway builds the root [Dockerfile](/D:/应用开发/我的音乐助手/Dockerfile)
- FastAPI serves both the API and the built frontend
- Railway provides an HTTPS domain for the web app
- A mounted volume keeps vocal profiles across restarts

## What This Deploy Shape Looks Like

- `https://your-app.up.railway.app/` serves the mobile web app
- `https://your-app.up.railway.app/api/*` serves the backend API
- vocal profile data is stored in a Railway volume mounted at `/data`

## Before You Deploy

1. Push this project to GitHub or another Git provider connected to Railway.
2. Create a Railway account and a new project.
3. Make sure the root directory of the deploy source contains the project `Dockerfile`.

## Railway Setup

1. In Railway, create a new service from your repo.
2. Railway will detect the root `Dockerfile` and build the app as one service.
3. Add a volume to the service and mount it at `/data`.
4. Add this environment variable:

```text
SINGMYKEY_DATA_DIR=/data
```

5. Deploy the service.
6. Open the generated Railway domain over HTTPS.

## Why The Volume Matters

The vocal range profile store is file-based. Without a mounted volume, saved profiles can be lost after a redeploy or restart.

## Mobile Notes

- On iPhone, open the Railway HTTPS URL in Safari.
- Use Safari's "Add to Home Screen" action if you want it to behave more like an app.
- For recording, use headphones to avoid accompaniment bleeding into the microphone.

## Custom API Domain

You usually do not need to set `VITE_API_BASE_URL` in the single-service deployment.

The frontend now detects:

- `localhost` -> `http://localhost:8000`
- local LAN dev hosts like `192.168.x.x:3000` -> `http://same-host:8000`
- production same-origin deploys -> current site origin

## Production Checklist

- HTTPS Railway domain opens successfully
- `GET /api/health` returns `200`
- you can save a vocal profile
- you can upload a song and get a processed accompaniment
- you can record a take and export the final mixed song
