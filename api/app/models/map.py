from pydantic import BaseModel

from app.models.report import ReportStatus


class MapReport(BaseModel):
    """Anonymous pin for the public map: no reporter, no typed address, rounded location."""

    id: str
    request_type: str
    request_reason: str
    status: ReportStatus
    lat: float
    lng: float
    supporter_count: int
    created_at: str


class MapReports(BaseModel):
    reports: list[MapReport]
    truncated: bool
