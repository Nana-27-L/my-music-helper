from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import suppress
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import librosa
import soundfile as sf


DEMUCS_MODEL = os.getenv("SINGMYKEY_DEMUCS_MODEL", "htdemucs")


@dataclass(frozen=True)
class SeparatedStems:
    output_dir: Path
    vocals_path: Path
    accompaniment_path: Path


def build_unavailable_message() -> str:
    return (
        "Stem separation is unavailable in this environment. "
        "Install `demucs` (recommended for Python 3.11+) or install "
        "`spleeter==2.4.2` inside a Python 3.10 virtual environment."
    )


@lru_cache(maxsize=1)
def has_demucs() -> bool:
    try:
        import demucs.separate  # noqa: F401
    except ImportError:
        return False

    return True


@lru_cache(maxsize=1)
def get_spleeter_separator() -> Any:
    try:
        from spleeter.separator import Separator
    except ImportError as exc:
        raise RuntimeError(build_unavailable_message()) from exc

    return Separator("spleeter:2stems")


def cleanup_directory(path: Path | None) -> None:
    if path is None:
        return

    with suppress(FileNotFoundError):
        shutil.rmtree(path)


def convert_audio_to_wav(input_path: Path, output_path: Path) -> None:
    audio, sample_rate = librosa.load(input_path, sr=None, mono=False)
    audio_to_write = audio.T if getattr(audio, "ndim", 1) > 1 else audio
    sf.write(output_path, audio_to_write, sample_rate, format="WAV")


def find_generated_stem(output_dir: Path, file_name: str) -> Path | None:
    matches = sorted(output_dir.rglob(file_name))
    return matches[0] if matches else None


def summarize_subprocess_failure(process: subprocess.CompletedProcess[str]) -> str:
    details = (process.stderr or process.stdout or "").strip()

    if not details:
        return "the separator exited without additional diagnostics"

    lines = [line.strip() for line in details.splitlines() if line.strip()]
    return lines[-1] if lines else "the separator exited without additional diagnostics"


def separate_stems_with_demucs(input_path: Path) -> SeparatedStems:
    if not input_path.exists():
        raise FileNotFoundError(f"Input audio file does not exist: {input_path}")

    if not has_demucs():
        raise RuntimeError(build_unavailable_message())

    output_dir = Path(tempfile.mkdtemp(prefix="demucs_"))
    prepared_input_path = output_dir / f"{input_path.stem or 'input'}.wav"

    try:
        convert_audio_to_wav(input_path, prepared_input_path)

        process = subprocess.run(
            [
                sys.executable,
                "-m",
                "demucs.separate",
                "--two-stems=vocals",
                "-n",
                DEMUCS_MODEL,
                "-d",
                "cpu",
                "-o",
                str(output_dir),
                str(prepared_input_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        if process.returncode != 0:
            raise RuntimeError(
                "Demucs separation failed: "
                f"{summarize_subprocess_failure(process)}",
            )

        vocals_path = find_generated_stem(output_dir, "vocals.wav")
        accompaniment_path = (
            find_generated_stem(output_dir, "no_vocals.wav")
            or find_generated_stem(output_dir, "accompaniment.wav")
        )

        if not vocals_path or not accompaniment_path:
            raise RuntimeError(
                "Demucs finished without producing both vocals.wav and no_vocals.wav.",
            )

        return SeparatedStems(
            output_dir=output_dir,
            vocals_path=vocals_path,
            accompaniment_path=accompaniment_path,
        )
    except Exception:
        cleanup_directory(output_dir)
        raise


def separate_stems_with_spleeter(input_path: Path) -> SeparatedStems:
    """
    Split an MP3 into vocals and accompaniment using Spleeter 2-stem separation.

    Spleeter writes WAV files into a temp output directory. The caller is
    responsible for cleaning up `result.output_dir` when the files are no longer
    needed.
    """

    if not input_path.exists():
        raise FileNotFoundError(f"Input audio file does not exist: {input_path}")

    if input_path.suffix.lower() != ".mp3":
        raise ValueError("Spleeter separation currently expects an MP3 input file.")

    separator = get_spleeter_separator()
    output_dir = Path(tempfile.mkdtemp(prefix="spleeter_"))

    try:
        separator.separate_to_file(
            str(input_path),
            str(output_dir),
            codec="wav",
            filename_format="{filename}/{instrument}.{codec}",
            synchronous=True,
        )

        stem_dir = output_dir / input_path.stem
        vocals_path = stem_dir / "vocals.wav"
        accompaniment_path = stem_dir / "accompaniment.wav"

        if not vocals_path.exists() or not accompaniment_path.exists():
            raise RuntimeError(
                "Spleeter finished without producing both vocals.wav and accompaniment.wav.",
            )

        return SeparatedStems(
            output_dir=output_dir,
            vocals_path=vocals_path,
            accompaniment_path=accompaniment_path,
        )
    except Exception:
        cleanup_directory(output_dir)
        raise


def separate_accompaniment_from_mp3(input_path: Path) -> Path:
    """
    Split an MP3 into vocals and accompaniment, and return the accompaniment WAV path.

    The vocals file is written alongside it in the same temp directory.
    """

    result = separate_stems_with_spleeter(input_path)
    return result.accompaniment_path


def separate_stems(input_path: Path) -> SeparatedStems:
    if has_demucs():
        return separate_stems_with_demucs(input_path)

    try:
        return separate_stems_with_spleeter(input_path)
    except RuntimeError as exc:
        if str(exc) == build_unavailable_message():
            raise RuntimeError(build_unavailable_message()) from exc

        raise
