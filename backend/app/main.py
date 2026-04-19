import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes.audio import router as audio_router
from app.api.routes.health import router as health_router
from app.api.routes.profile import router as profile_router

app = FastAPI(title="SingMyKey API")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FRONTEND_DIST_DIR = PROJECT_ROOT / "frontend" / "dist"
VERCEL_FRONTEND_DIST_DIR = PROJECT_ROOT / "public"
FRONTEND_DIST_DIR = Path(
    os.environ.get(
        "SINGMYKEY_FRONTEND_DIST",
        VERCEL_FRONTEND_DIST_DIR
        if VERCEL_FRONTEND_DIST_DIR.exists()
        else DEFAULT_FRONTEND_DIST_DIR,
    ),
).resolve()
FRONTEND_INDEX_PATH = FRONTEND_DIST_DIR / "index.html"

allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
allowed_origin_regex = (
    r"^https?://("
    r"localhost|"
    r"127\.0\.0\.1|"
    r"10(?:\.\d{1,3}){3}|"
    r"192\.168(?:\.\d{1,3}){2}|"
    r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
    r")(?::\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-SingMyKey-Applied-Shift",
        "X-SingMyKey-Recommended-Shift",
        "X-SingMyKey-Song-Low-Note",
        "X-SingMyKey-Song-High-Note",
        "X-SingMyKey-Comfort-Low-Note",
        "X-SingMyKey-Comfort-High-Note",
        "X-SingMyKey-Processing-Mode",
    ],
)

app.include_router(health_router, prefix="/api")
app.include_router(audio_router, prefix="/api")
app.include_router(profile_router, prefix="/api")


if FRONTEND_DIST_DIR.exists():
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_DIST_DIR, html=True),
        name="frontend",
    )


@app.get("/", include_in_schema=False, response_model=None)
def read_root():
    if FRONTEND_INDEX_PATH.exists():
        return FileResponse(FRONTEND_INDEX_PATH)

    return {"message": "SingMyKey backend is running."}
