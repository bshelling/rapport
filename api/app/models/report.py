from typing import Literal

from pydantic import BaseModel

from app.models.draft import Location
from app.models.profile import Contact

ReportStatus = Literal["submitted", "filed_with_311", "in_progress", "resolved", "closed_duplicate"]


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
