import re
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.neighborhoods import NEIGHBORHOODS

PhoneType = Literal["mobile", "home"]


class Contact(BaseModel):
    """Contact section of the NOLA 311 form."""

    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    email: EmailStr
    phone: str | None = None
    phone_type: PhoneType | None = None

    @field_validator("first_name", "last_name")
    @classmethod
    def strip_names(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        digits = re.sub(r"\D", "", v)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) != 10:
            raise ValueError("enter a 10-digit US phone number")
        return digits


class ProfileUpdate(Contact):
    """Contact info used to prefill service requests, plus home neighborhood."""

    neighborhood: str | None = None

    @field_validator("neighborhood")
    @classmethod
    def known_neighborhood(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        if v not in NEIGHBORHOODS:
            raise ValueError("unknown neighborhood")
        return v


class Profile(BaseModel):
    sub: str
    first_name: str = ""
    last_name: str = ""
    email: str | None = None
    phone: str | None = None
    phone_type: PhoneType | None = None
    neighborhood: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @property
    def is_complete(self) -> bool:
        return bool(self.first_name and self.last_name and self.email)
