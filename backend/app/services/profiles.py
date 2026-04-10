from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PROFILE_STORE_LOCK = threading.Lock()
DATA_DIR = Path(
    os.environ.get("SINGMYKEY_DATA_DIR", Path(__file__).resolve().parents[2] / "data"),
).resolve()
PROFILE_STORE_PATH = DATA_DIR / "vocal_profiles.json"


def midi_to_note_name(midi: int) -> str:
    note_index = midi % 12
    octave = midi // 12 - 1

    return f"{NOTE_NAMES[note_index]}{octave}"


def midi_to_frequency(midi: int) -> float:
    return round(440.0 * (2 ** ((midi - 69) / 12)), 4)


def build_note_from_midi(midi: int) -> dict[str, Any]:
    return {
        "midi": midi,
        "note_name": midi_to_note_name(midi),
        "frequency": midi_to_frequency(midi),
    }


def ensure_profile_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not PROFILE_STORE_PATH.exists():
        PROFILE_STORE_PATH.write_text("{}", encoding="utf-8")


def read_profile_store() -> dict[str, Any]:
    ensure_profile_store()

    with PROFILE_STORE_LOCK:
        return json.loads(PROFILE_STORE_PATH.read_text(encoding="utf-8"))


def write_profile_store(profiles: dict[str, Any]) -> None:
    ensure_profile_store()

    with PROFILE_STORE_LOCK:
        PROFILE_STORE_PATH.write_text(
            json.dumps(profiles, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )


def calculate_comfort_margin(low_midi: int, high_midi: int) -> int:
    width = high_midi - low_midi

    if width >= 10:
        return 2

    if width >= 6:
        return 1

    return 0


def create_vocal_profile(lowest_note: dict[str, Any], highest_note: dict[str, Any]) -> dict[str, Any]:
    low_midi = int(lowest_note["midi"])
    high_midi = int(highest_note["midi"])

    if low_midi >= high_midi:
        raise ValueError("The highest note must be above the lowest note.")

    margin = calculate_comfort_margin(low_midi, high_midi)
    comfortable_low_midi = low_midi + margin
    comfortable_high_midi = high_midi - margin

    if comfortable_low_midi > comfortable_high_midi:
        comfortable_low_midi = low_midi
        comfortable_high_midi = high_midi
        margin = 0

    profile = {
        "id": uuid.uuid4().hex,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "lowest_note": lowest_note,
        "highest_note": highest_note,
        "comfortable_low_note": build_note_from_midi(comfortable_low_midi),
        "comfortable_high_note": build_note_from_midi(comfortable_high_midi),
        "recommended_center_note": build_note_from_midi(
            round((comfortable_low_midi + comfortable_high_midi) / 2),
        ),
        "comfortable_margin_semitones": margin,
    }

    profiles = read_profile_store()
    profiles[profile["id"]] = profile
    write_profile_store(profiles)

    return profile


def get_vocal_profile(profile_id: str) -> dict[str, Any] | None:
    profiles = read_profile_store()
    return profiles.get(profile_id)
