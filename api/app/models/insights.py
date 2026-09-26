from typing import Literal

from pydantic import BaseModel, Field

ImageQuality = Literal["good", "blurry", "too_dark", "too_far", "not_a_street_scene"]


class Observation(BaseModel):
    """What Claude sees in the photo (tool input, validated here)."""

    scene_description: str = Field(max_length=1200)
    visible_objects: list[str] = Field(default_factory=list, max_length=20)
    landmarks: list[str] = Field(default_factory=list, max_length=10)
    image_quality: ImageQuality
    contains_person_or_plate: bool
    suggested_description: str = Field(max_length=600)


class ReasonOption(BaseModel):
    request_type: str | None  # None for "not an issue"
    request_reason: str
    probability: float


class Severity(BaseModel):
    level: int = Field(ge=1, le=4)
    label: str
    score: float
    confidence: float


class Triage(BaseModel):
    status: Literal["pending", "done", "error"]
    photo_id: str
    observation: Observation | None = None
    suggested: ReasonOption | None = None
    alternatives: list[ReasonOption] = []
    reason_confidence: float | None = None
    severity: Severity | None = None
    is_actionable: float | None = None
    safety_hazard: float | None = None
    matches_selection: float | None = None
    error: str | None = None
    updated_at: str


class Insights(BaseModel):
    triage: Triage | None = None
