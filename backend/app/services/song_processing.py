from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np

from app.services.profiles import build_note_from_midi

MIN_ANALYSIS_FRAMES = 24
PYIN_FMIN = librosa.note_to_hz("C2")
PYIN_FMAX = librosa.note_to_hz("C6")


@dataclass(frozen=True)
class SongAnalysisResult:
    song_low_midi: int
    song_high_midi: int
    comfortable_low_midi: int
    comfortable_high_midi: int
    recommended_semitones: int

    @property
    def song_low_note(self) -> dict[str, float | int | str]:
        return build_note_from_midi(self.song_low_midi)

    @property
    def song_high_note(self) -> dict[str, float | int | str]:
        return build_note_from_midi(self.song_high_midi)

    @property
    def comfortable_low_note(self) -> dict[str, float | int | str]:
        return build_note_from_midi(self.comfortable_low_midi)

    @property
    def comfortable_high_note(self) -> dict[str, float | int | str]:
        return build_note_from_midi(self.comfortable_high_midi)


def analyze_vocal_range(vocals_path: Path) -> tuple[int, int]:
    audio, sample_rate = librosa.load(vocals_path, sr=None, mono=True)
    f0, voiced_flag, _voiced_probability = librosa.pyin(
        audio,
        fmin=PYIN_FMIN,
        fmax=PYIN_FMAX,
    )

    voiced_frequencies = f0[np.isfinite(f0)]

    if voiced_flag is not None:
        voiced_frequencies = voiced_frequencies[np.isfinite(voiced_frequencies)]

    if voiced_frequencies.size < MIN_ANALYSIS_FRAMES:
        raise RuntimeError("Not enough stable vocal frames were detected in the uploaded song.")

    midi_values = librosa.hz_to_midi(voiced_frequencies)
    song_low_midi = int(math.floor(np.percentile(midi_values, 5)))
    song_high_midi = int(math.ceil(np.percentile(midi_values, 95)))

    if song_low_midi >= song_high_midi:
        raise RuntimeError("Unable to estimate a reliable vocal range for the uploaded song.")

    return song_low_midi, song_high_midi


def recommend_semitones_for_profile(
    song_low_midi: int,
    song_high_midi: int,
    comfortable_low_midi: int,
    comfortable_high_midi: int,
) -> int:
    feasible_low = comfortable_low_midi - song_low_midi
    feasible_high = comfortable_high_midi - song_high_midi
    target_center_shift = round(
        ((comfortable_low_midi + comfortable_high_midi) / 2)
        - ((song_low_midi + song_high_midi) / 2),
    )

    if math.ceil(feasible_low) <= math.floor(feasible_high):
        return int(
            min(
                max(target_center_shift, math.ceil(feasible_low)),
                math.floor(feasible_high),
            ),
        )

    return int(max(-12, min(12, target_center_shift)))


def analyze_song_for_profile(vocals_path: Path, profile: dict[str, object]) -> SongAnalysisResult:
    comfortable_low_midi = int(profile["comfortable_low_note"]["midi"])
    comfortable_high_midi = int(profile["comfortable_high_note"]["midi"])
    song_low_midi, song_high_midi = analyze_vocal_range(vocals_path)
    recommended_semitones = recommend_semitones_for_profile(
        song_low_midi=song_low_midi,
        song_high_midi=song_high_midi,
        comfortable_low_midi=comfortable_low_midi,
        comfortable_high_midi=comfortable_high_midi,
    )

    return SongAnalysisResult(
        song_low_midi=song_low_midi,
        song_high_midi=song_high_midi,
        comfortable_low_midi=comfortable_low_midi,
        comfortable_high_midi=comfortable_high_midi,
        recommended_semitones=recommended_semitones,
    )
