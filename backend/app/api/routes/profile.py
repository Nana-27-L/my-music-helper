from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.vocal_profile import CreateVocalProfileRequest, VocalProfileResponse
from app.services.profiles import create_vocal_profile, get_vocal_profile

router = APIRouter(tags=["profile"])


def model_to_dict(model: object) -> dict[str, object]:
    if hasattr(model, "model_dump"):
        return model.model_dump()

    return model.dict()


@router.post("/vocal-profile", response_model=VocalProfileResponse)
def create_profile(payload: CreateVocalProfileRequest) -> VocalProfileResponse:
    try:
        profile = create_vocal_profile(
            lowest_note=model_to_dict(payload.lowest_note),
            highest_note=model_to_dict(payload.highest_note),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return VocalProfileResponse(**profile)


@router.get("/vocal-profile/{profile_id}", response_model=VocalProfileResponse)
def read_profile(profile_id: str) -> VocalProfileResponse:
    profile = get_vocal_profile(profile_id)

    if not profile:
        raise HTTPException(status_code=404, detail="Vocal profile not found.")

    return VocalProfileResponse(**profile)
