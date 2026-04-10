from __future__ import annotations

import math
import tempfile
from contextlib import suppress
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf


def cleanup_file(path: Path | None) -> None:
    if path is None:
        return

    with suppress(FileNotFoundError):
        path.unlink()


def create_temp_output_path(suffix: str = ".wav") -> Path:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        return Path(temp_file.name)


def load_audio_channels(input_path: Path, sample_rate: int | None = None) -> tuple[np.ndarray, int]:
    audio, resolved_sample_rate = librosa.load(input_path, sr=sample_rate, mono=False)

    if audio.ndim == 1:
        audio = audio[np.newaxis, :]

    return audio.astype(np.float32), resolved_sample_rate


def resample_channels(audio: np.ndarray, original_sample_rate: int, target_sample_rate: int) -> np.ndarray:
    if original_sample_rate == target_sample_rate:
        return audio

    return np.stack(
        [
            librosa.resample(
                channel,
                orig_sr=original_sample_rate,
                target_sr=target_sample_rate,
            )
            for channel in audio
        ],
        axis=0,
    )


def match_channel_count(audio: np.ndarray, target_channels: int) -> np.ndarray:
    current_channels = audio.shape[0]

    if current_channels == target_channels:
        return audio

    if current_channels == 1:
        return np.repeat(audio, target_channels, axis=0)

    mono_mix = np.mean(audio, axis=0, keepdims=True)

    if target_channels == 1:
        return mono_mix

    return np.repeat(mono_mix, target_channels, axis=0)


def pad_channels(audio: np.ndarray, target_length: int) -> np.ndarray:
    if audio.shape[1] >= target_length:
        return audio

    return np.pad(audio, ((0, 0), (0, target_length - audio.shape[1])))


def db_to_gain(db: float) -> float:
    return math.pow(10, db / 20)


def mix_vocals_with_accompaniment(
    accompaniment_path: Path,
    vocal_path: Path,
    *,
    accompaniment_gain_db: float = -4.0,
    vocal_gain_db: float = 0.0,
) -> tuple[Path, int]:
    accompaniment_audio, sample_rate = load_audio_channels(accompaniment_path)
    vocal_audio, vocal_sample_rate = load_audio_channels(vocal_path)

    if vocal_sample_rate != sample_rate:
        vocal_audio = resample_channels(vocal_audio, vocal_sample_rate, sample_rate)

    vocal_audio = match_channel_count(vocal_audio, accompaniment_audio.shape[0])
    target_length = max(accompaniment_audio.shape[1], vocal_audio.shape[1])
    accompaniment_audio = pad_channels(accompaniment_audio, target_length)
    vocal_audio = pad_channels(vocal_audio, target_length)

    mixed_audio = (
        accompaniment_audio * db_to_gain(accompaniment_gain_db)
        + vocal_audio * db_to_gain(vocal_gain_db)
    )

    peak = float(np.max(np.abs(mixed_audio))) if mixed_audio.size else 0.0
    if peak > 0.99:
        mixed_audio = mixed_audio * (0.99 / peak)

    output_path = create_temp_output_path(".wav")
    sf.write(output_path, mixed_audio.T, sample_rate, format="WAV")
    return output_path, sample_rate


def pitch_shift_audio(input_path: Path, semitones: float) -> tuple[Path, int]:
    audio, sample_rate = load_audio_channels(input_path)
    shifted_channels = [
        librosa.effects.pitch_shift(
            y=channel,
            sr=sample_rate,
            n_steps=semitones,
        )
        for channel in audio
    ]
    shifted_audio = np.stack(shifted_channels, axis=0)

    output_path = create_temp_output_path(".wav")
    audio_to_write = shifted_audio.T if shifted_audio.ndim > 1 else shifted_audio
    sf.write(output_path, audio_to_write, sample_rate, format="WAV")

    return output_path, sample_rate
