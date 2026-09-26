import re
from typing import Literal

from pydantic import BaseModel, field_validator

from app.models.draft import Location
from app.models.profile import Contact

ReportStatus = Literal["submitted", "filed_with_311", "in_progress", "resolved", "closed_duplicate"]
OPEN_STATUSES: tuple[str, ...] = ("submitted", "filed_with_311", "in_progress")

# NOLA 311 service request numbers look like 2026-1322736.
TICKET_RE = re.compile(r"^\d{4}-\d{4,8}$")


class Report(BaseModel):
    id: str
    request_type: str
    request_reason: str
    contact: Contact
    location: Location
    description_html: str
    photo_keys: list[str]
    status: ReportStatus
    supporter_count: int = 0
    created_at: str
    updated_at: str


class ReportSummary(BaseModel):
    """A row on the reporter's dashboard."""

    id: str
    request_type: str
    request_reason: str
    status: ReportStatus
    address: str | None
    lat: float
    lng: float
    supporter_count: int
    photo_count: int
    thumbnail_url: str | None
    nola311_ticket: str | None
    created_at: str
    updated_at: str


class ReportEvent(BaseModel):
    status: ReportStatus
    source: Literal["user", "nola311", "ai", "system"]
    note: str | None = None
    created_at: str


class ReportPhoto(BaseModel):
    key: str
    url: str


class SuggestedTicket(BaseModel):
    ticket: str
    probability: float


class ReportAI(BaseModel):
    """AI assessment captured at submission (Claude vision + Jev)."""

    suggested_reason: str | None = None
    reason_confidence: float | None = None
    severity_level: int | None = None
    severity_label: str | None = None
    safety_hazard: float | None = None
    matches_selection: float | None = None
    scene_description: str | None = None


class ReportDetail(BaseModel):
    """Full report. Contact info is only included for the reporter."""

    id: str
    is_owner: bool
    request_type: str
    request_reason: str
    status: ReportStatus
    location: Location
    description_html: str
    photos: list[ReportPhoto]
    photo_public: bool = False
    ai: ReportAI | None = None
    supported_by_me: bool = False
    supporter_count: int
    nola311_ticket: str | None
    nola311_verified: bool = False
    suggested_ticket: SuggestedTicket | None = None
    contact: Contact | None
    events: list[ReportEvent]
    created_at: str
    updated_at: str


class ReportPage(BaseModel):
    reports: list[ReportSummary]
    next_cursor: str | None


class TicketUpdate(BaseModel):
    nola311_ticket: str | None = None
    # "No, that's not my request" for an auto-suggested City ticket.
    dismiss_ticket_suggestion: bool = False

    @field_validator("nola311_ticket")
    @classmethod
    def ticket_format(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not TICKET_RE.match(v):
            raise ValueError("enter the NOLA 311 request number, e.g. 2026-1322736")
        return v


class SupportRequest(BaseModel):
    # When the +1 comes from the report flow, the draft (and its photo) is folded in.
    draft_id: str | None = None


class SupportResult(BaseModel):
    report_id: str
    supporter_count: int
