from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.catalog import REASONS_BY_TYPE, is_valid_pair
from app.geo import in_new_orleans
from app.html import plain_text, sanitize
from app.models.insights import DuplicateCheck, Triage
from app.models.profile import Contact

MAX_PHOTOS = 3
DESCRIPTION_MIN, DESCRIPTION_MAX = 10, 2000


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=200)
    source: Literal["gps", "photo", "manual"] = "manual"

    @model_validator(mode="after")
    def inside_new_orleans(self):
        if not in_new_orleans(self.lat, self.lng):
            raise ValueError("location must be in New Orleans")
        return self


class Photo(BaseModel):
    id: str
    key: str
    url: str | None = None  # short-lived presigned GET, filled on read


class DraftPatch(BaseModel):
    """Partial update sent as each step of the report flow is completed."""

    step: int | None = Field(default=None, ge=1, le=3)
    request_type: str | None = None
    request_reason: str | None = None
    contact: Contact | None = None
    location: Location | None = None
    description_html: str | None = Field(default=None, max_length=10_000)

    @field_validator("request_type")
    @classmethod
    def known_type(cls, v: str | None) -> str | None:
        if v is not None and v not in REASONS_BY_TYPE:
            raise ValueError("unknown request type")
        return v

    @field_validator("description_html")
    @classmethod
    def clean_description(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = sanitize(v)
        if len(plain_text(cleaned)) > DESCRIPTION_MAX:
            raise ValueError(f"description must be at most {DESCRIPTION_MAX} characters")
        return cleaned

    @model_validator(mode="after")
    def reason_matches_type(self):
        if self.request_reason is not None and not is_valid_pair(
            self.request_type, self.request_reason
        ):
            raise ValueError("request_reason does not belong to request_type")
        return self


class Draft(BaseModel):
    id: str
    step: int = 1
    request_type: str | None = None
    request_reason: str | None = None
    contact: Contact | None = None
    location: Location | None = None
    description_html: str | None = None
    photos: list[Photo] = []
    triage: Triage | None = None
    duplicates: DuplicateCheck | None = None
    photos_private: bool = False
    created_at: str
    updated_at: str

    def missing_fields(self) -> list[str]:
        missing = []
        if not is_valid_pair(self.request_type, self.request_reason):
            missing.append("request_reason")
        if self.contact is None:
            missing.append("contact")
        if self.location is None:
            missing.append("location")
        if len(plain_text(self.description_html or "")) < DESCRIPTION_MIN:
            missing.append("description")
        return missing


class PhotoUploadRequest(BaseModel):
    content_type: Literal["image/jpeg"] = "image/jpeg"


class PhotoUpload(BaseModel):
    photo: Photo
    upload_url: str
    fields: dict[str, str]
    max_bytes: int
