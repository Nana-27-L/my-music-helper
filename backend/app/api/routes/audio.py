from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTasks

from app.services.audio import cleanup_file, mix_vocals_with_accompaniment, pitch_shift_audio
from app.services.profiles import get_vocal_profile
from app.services.separation import cleanup_directory, separate_stems
from app.services.song_processing import analyze_song_for_profile

router = APIRouter(tags=["audio"])

ALLOWED_SUFFIXES = {".mp3"}
ALLOWED_CONTENT_TYPES = {"audio/mpeg", "audio/mp3", "application/octet-stream"}
MIX_ALLOWED_SUFFIXES = {".wav", ".wave"}
MIX_ALLOWED_CONTENT_TYPES = {
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/vnd.wave",
    "application/octet-stream",
}
SEPARATION_UNAVAILABLE_MARKER = "Stem separation is unavailable in this environment."


def build_download_name(original_name: str | None, semitones: float) -> str:
    stem = Path(original_name or "audio").stem or "audio"
    normalized = int(semitones) if float(semitones).is_integer() else semitones
    shift_label = str(normalized).replace("+", "plus").replace("-", "minus")

    return f"{stem}_shifted_{shift_label}.wav"


def build_mix_download_name(original_name: str | None) -> str:
    stem = Path(original_name or "singmykey_mix").stem or "singmykey_mix"
    return f"{stem}_with_vocals.wav"


def build_song_headers(
    applied_semitones: int,
    processing_mode: str,
    analysis: object | None = None,
) -> dict[str, str]:
    headers = {
        "X-SingMyKey-Applied-Shift": str(applied_semitones),
        "X-SingMyKey-Processing-Mode": processing_mode,
    }

    if analysis is None:
        return headers

    headers.update(
        {
            "X-SingMyKey-Recommended-Shift": str(analysis.recommended_semitones),
            "X-SingMyKey-Song-Low-Note": analysis.song_low_note["note_name"],
            "X-SingMyKey-Song-High-Note": analysis.song_high_note["note_name"],
            "X-SingMyKey-Comfort-Low-Note": analysis.comfortable_low_note["note_name"],
            "X-SingMyKey-Comfort-High-Note": analysis.comfortable_high_note["note_name"],
        },
    )
    return headers


@router.post("/process-audio", response_class=FileResponse)
async def process_audio(
    audio_file: Annotated[UploadFile, File(description="MP3 audio file to pitch shift")],
    semitones: Annotated[
        float,
        Form(description="Number of semitones to shift", ge=-24, le=24),
    ],
) -> FileResponse:
    suffix = Path(audio_file.filename or "").suffix.lower()

    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Only MP3 uploads are supported.")

    if audio_file.content_type and audio_file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported audio content type.")

    input_path: Path | None = None
    output_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_input:
            shutil.copyfileobj(audio_file.file, temp_input)
            input_path = Path(temp_input.name)

        output_path, _sample_rate = pitch_shift_audio(input_path, semitones)

        background_tasks = BackgroundTasks()
        background_tasks.add_task(cleanup_file, input_path)
        background_tasks.add_task(cleanup_file, output_path)

        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename=build_download_name(audio_file.filename, semitones),
            background=background_tasks,
        )
    except Exception as exc:
        cleanup_file(input_path)
        cleanup_file(output_path)
        raise HTTPException(
            status_code=500,
            detail=f"Audio processing failed: {exc}",
        ) from exc
    finally:
        await audio_file.close()


@router.post("/process-song", response_class=FileResponse)
async def process_song(
    audio_file: Annotated[UploadFile, File(description="MP3 song file to auto-process")],
    profile_id: Annotated[str, Form(description="Saved SingMyKey vocal profile id")],
    semitones: Annotated[
        int | None,
        Form(description="Optional manual override for semitone shift", ge=-24, le=24),
    ] = None,
) -> FileResponse:
    suffix = Path(audio_file.filename or "").suffix.lower()

    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Only MP3 uploads are supported.")

    if audio_file.content_type and audio_file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported audio content type.")

    profile = get_vocal_profile(profile_id)

    if not profile:
        raise HTTPException(status_code=404, detail="Vocal profile not found.")

    input_path: Path | None = None
    output_path: Path | None = None
    separation_output_dir: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_input:
            shutil.copyfileobj(audio_file.file, temp_input)
            input_path = Path(temp_input.name)

        try:
            separated = separate_stems(input_path)
        except RuntimeError as exc:
            if SEPARATION_UNAVAILABLE_MARKER not in str(exc):
                raise

            if semitones is None:
                raise RuntimeError(
                    f"{exc} Add a manual semitone override to continue with direct song pitch shifting.",
                ) from exc

            applied_semitones = semitones
            output_path, _sample_rate = pitch_shift_audio(input_path, applied_semitones)

            background_tasks = BackgroundTasks()
            background_tasks.add_task(cleanup_file, input_path)
            background_tasks.add_task(cleanup_file, output_path)

            return FileResponse(
                path=output_path,
                media_type="audio/wav",
                filename=build_download_name(audio_file.filename, applied_semitones),
                background=background_tasks,
                headers=build_song_headers(
                    applied_semitones=applied_semitones,
                    processing_mode="direct-full-mix",
                ),
            )

        separation_output_dir = separated.output_dir
        analysis = analyze_song_for_profile(separated.vocals_path, profile)
        applied_semitones = semitones if semitones is not None else analysis.recommended_semitones
        output_path, _sample_rate = pitch_shift_audio(
            separated.accompaniment_path,
            applied_semitones,
        )

        background_tasks = BackgroundTasks()
        background_tasks.add_task(cleanup_file, input_path)
        background_tasks.add_task(cleanup_file, output_path)
        background_tasks.add_task(cleanup_directory, separation_output_dir)

        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename=build_download_name(audio_file.filename, applied_semitones),
            background=background_tasks,
            headers=build_song_headers(
                applied_semitones=applied_semitones,
                processing_mode="separated-accompaniment",
                analysis=analysis,
            ),
        )
    except RuntimeError as exc:
        cleanup_file(input_path)
        cleanup_file(output_path)
        cleanup_directory(separation_output_dir)
        error_message = str(exc)
        status_code = (
            500
            if "Spleeter is not installed" in error_message
            else 422
        )
        raise HTTPException(status_code=status_code, detail=error_message) from exc
    except Exception as exc:
        cleanup_file(input_path)
        cleanup_file(output_path)
        cleanup_directory(separation_output_dir)
        raise HTTPException(
            status_code=500,
            detail=f"Song processing failed: {exc}",
        ) from exc
    finally:
        await audio_file.close()


@router.post("/mix-recording", response_class=FileResponse)
async def mix_recording(
    accompaniment_file: Annotated[UploadFile, File(description="Processed accompaniment WAV file")],
    vocal_file: Annotated[UploadFile, File(description="Recorded vocal WAV file")],
    accompaniment_gain_db: Annotated[
        float,
        Form(description="Accompaniment gain in dB", ge=-24, le=12),
    ] = -4.0,
    vocal_gain_db: Annotated[
        float,
        Form(description="Vocal gain in dB", ge=-24, le=12),
    ] = 0.0,
) -> FileResponse:
    accompaniment_suffix = Path(accompaniment_file.filename or "").suffix.lower()
    vocal_suffix = Path(vocal_file.filename or "").suffix.lower()

    if accompaniment_suffix not in MIX_ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Accompaniment upload must be a WAV file.")

    if vocal_suffix not in MIX_ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Vocal recording upload must be a WAV file.")

    if (
        accompaniment_file.content_type
        and accompaniment_file.content_type not in MIX_ALLOWED_CONTENT_TYPES
    ):
        raise HTTPException(status_code=400, detail="Unsupported accompaniment audio format.")

    if vocal_file.content_type and vocal_file.content_type not in MIX_ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported vocal recording format.")

    accompaniment_path: Path | None = None
    vocal_path: Path | None = None
    output_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=accompaniment_suffix) as temp_input:
            shutil.copyfileobj(accompaniment_file.file, temp_input)
            accompaniment_path = Path(temp_input.name)

        with tempfile.NamedTemporaryFile(delete=False, suffix=vocal_suffix) as temp_input:
            shutil.copyfileobj(vocal_file.file, temp_input)
            vocal_path = Path(temp_input.name)

        output_path, _sample_rate = mix_vocals_with_accompaniment(
            accompaniment_path,
            vocal_path,
            accompaniment_gain_db=accompaniment_gain_db,
            vocal_gain_db=vocal_gain_db,
        )

        background_tasks = BackgroundTasks()
        background_tasks.add_task(cleanup_file, accompaniment_path)
        background_tasks.add_task(cleanup_file, vocal_path)
        background_tasks.add_task(cleanup_file, output_path)

        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename=build_mix_download_name(accompaniment_file.filename),
            background=background_tasks,
        )
    except Exception as exc:
        cleanup_file(accompaniment_path)
        cleanup_file(vocal_path)
        cleanup_file(output_path)
        raise HTTPException(
            status_code=500,
            detail=f"Mix export failed: {exc}",
        ) from exc
    finally:
        await accompaniment_file.close()
        await vocal_file.close()
