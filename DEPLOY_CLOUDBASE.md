# Deploy SingMyKey To CloudBase

This repository should be deployed to CloudBase as a container service, not as static hosting.

## Why Your Current Deploy Failed

Your log shows this custom deploy command:

```text
tcb hosting deploy ./dist /Mymusic -e nana-3gacz4m8b9fe3d64
```

That failed for two separate reasons:

1. `./dist` does not exist at the repo root.
   This project builds the frontend into `frontend/dist`, not `/dist`.
2. `tcb hosting deploy` is for static hosting only.
   It can publish a frontend build, but it cannot run the FastAPI backend in `backend/app`.

According to the CloudBase docs, static hosting is for front-end project source and build output, while CloudBase cloud hosting supports long-running backend services and container deployments with a `Dockerfile`.

## Recommended Deploy Shape

Use one CloudBase container service:

- `/` serves the built mobile web app
- `/api/*` serves the FastAPI backend
- the root `Dockerfile` builds the frontend and runs the backend

This repository is already prepared for that shape.

## What To Select In CloudBase

Create a new CloudBase cloud hosting service with these choices:

1. Choose `Cloud Hosting`.
2. Choose `Container`.
3. Choose `Deploy from repository`.
4. Select this repo and the `main` branch.
5. Use the root `Dockerfile`.
6. Set the service port to `8000`.
7. Enable public access.

## Required Runtime Settings

Add this environment variable:

```text
SINGMYKEY_DATA_DIR=/data
```

If your CloudBase plan supports persistent storage, mount a data volume at:

```text
/data
```

Without a volume, saved vocal profiles may be lost after a restart or redeploy.

## Why The Root Dockerfile Works

The root [Dockerfile](./Dockerfile) already does the whole job:

- builds the Vite frontend
- installs the Python backend dependencies
- copies `frontend/dist` into the runtime image
- starts `uvicorn` on `0.0.0.0:${PORT:-8000}`

## What Not To Use

Do not use this command for the full product:

```text
tcb hosting deploy ./dist /Mymusic -e <env-id>
```

That command only fits a frontend-only static site.

## If You Only Want A Frontend Preview

You can still use static hosting for a temporary UI preview, but it will not support:

- vocal profile saving through FastAPI
- song upload and processing
- accompaniment export
- final mixed song export

For a preview-only static deploy, the build output you actually want is:

```text
frontend/dist
```

Not:

```text
./dist
```

## CloudBase References

- Static hosting deploys front-end project builds:
  [CloudBase Static Hosting](https://docs.cloudbase.net/hosting/web-hosting)
- Static hosting CI examples call `tcb hosting deploy ./dist ...` after a frontend build:
  [CloudBase Git CI/CD](https://docs.cloudbase.net/hosting/cli-devops)
- Container cloud hosting is the right fit for existing multi-language apps and requires a `Dockerfile`:
  [CloudBase Cloud Hosting](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/plugins/cloudrun)
