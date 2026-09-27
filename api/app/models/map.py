from typing import Literal

from pydantic import BaseModel

from app.models.report import ReportStatus


class MapReport(BaseModel):
    """Anonymous pin for the public map: no reporter, no typed address, rounded location."""

    id: str
    source: Literal["rapport", "nola311"] = "rapport"
    request_type: str
    request_reason: str
    status: ReportStatus
    lat: float
    lng: float
    supporter_count: int
    sample: bool = False
    created_at: str


class MapReports(BaseModel):
    reports: list[MapReport]
    city: list[MapReport] = []
    truncated: bool
