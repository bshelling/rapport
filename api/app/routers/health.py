from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "rapport-api"
    version: str
    environment: str


@router.get("/health")
def health() -> Health:
    settings = get_settings()
    return Health(version=settings.version, environment=settings.environment)
