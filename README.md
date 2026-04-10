# SingMyKey

SingMyKey is a full-stack singing helper:

- The frontend listens to your voice and estimates your stable vocal range.
- The backend saves a vocal profile with a comfort range.
- Song uploads can be analyzed and pitch-shifted into a version that better fits the saved profile.

## Project Structure

```text
SingMyKey/
|- frontend/
|  |- src/
|  |- package.json
|- backend/
|  |- app/
|  |- data/
|  |- requirements.txt
|  |- requirements-separation.txt
|  |- requirements-spleeter-py310.txt
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Default frontend URL: `http://localhost:3000`

You can override the backend API URL with:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

## Backend Setup

Create a virtual environment and install the base runtime:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Start the API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Default backend URL: `http://localhost:8000`

## Optional Stem Separation Backends

Automatic accompaniment extraction needs a stem separation backend.

Recommended for modern Python environments:

```bash
cd backend
.venv\Scripts\activate
pip install -r requirements-separation.txt
```

This installs Demucs and related runtime dependencies.

Legacy option for Python 3.10 or below:

```bash
cd backend
.venv\Scripts\activate
pip install -r requirements-spleeter-py310.txt
```

## Current Processing Behavior

- If automatic stem separation is available, `/api/process-song` separates vocals and accompaniment, analyzes the vocal range, and pitch-shifts the accompaniment.
- If separation is unavailable, manual semitone overrides still work through a direct full-song pitch shift fallback.

## HTTPS Mobile Web App Deployment

This project is now prepared for a single-domain HTTPS deployment where FastAPI serves both the API and the built frontend.

- Root deployment file: [Dockerfile](/D:/应用开发/我的音乐助手/Dockerfile)
- Mobile web app manifest: [site.webmanifest](/D:/应用开发/我的音乐助手/frontend/public/site.webmanifest)
- Railway deploy notes: [DEPLOY_RAILWAY.md](/D:/应用开发/我的音乐助手/DEPLOY_RAILWAY.md)

For persistent vocal profiles in production, mount a volume and set:

```text
SINGMYKEY_DATA_DIR=/data
```

### CloudBase Note

For CloudBase, do not use `tcb hosting deploy ./dist` for the full app.

- Static hosting is only for frontend-only builds.
- This repository contains a Python FastAPI backend and should be deployed as one container service with the root `Dockerfile`.
- For lower-tier CloudBase environments, use `Dockerfile.cloudbase` to reduce image build weight.
- See [DEPLOY_CLOUDBASE.md](./DEPLOY_CLOUDBASE.md) for the CloudBase-specific setup.

## Exposed Backend Endpoints

- `GET /api/health`
- `POST /api/vocal-profile`
- `GET /api/vocal-profile/{profile_id}`
- `POST /api/process-audio`
- `POST /api/process-song`

## Test Output

Local processing test artifacts can be written to:

```text
backend/test-output/
```
