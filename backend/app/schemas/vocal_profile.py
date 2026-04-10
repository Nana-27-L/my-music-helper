from __future__ import annotations

from pydantic import BaseModel, Field


class DetectedNote(BaseModel):
    midi: int = Field(ge=0, le=127)
    note_name: str = Field(min_length=2, max_length=4)
    frequency: float = Field(gt=0)


class CreateVocalProfileRequest(BaseModel):
    lowest_note: DetectedNote
    highest_note: DetectedNote


class VocalProfileResponse(BaseModel):
    id: str
    created_at: str
    lowest_note: DetectedNote
    highest_note: DetectedNote
    comfortable_low_note: DetectedNote
    comfortable_high_note: DetectedNote
    recommended_center_note: DetectedNote
    comfortable_margin_semitones: int = Field(ge=0)

