from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status

from app.auth import CurrentUserDep
from app.models.report import (
    ReportDetail,
    ReportPage,
    SupportRequest,
    SupportResult,
    TicketUpdate,
)
from app.services import drafts, reports

router = APIRouter(prefix="/reports", tags=["reports"])


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")


@router.get("/mine")
def my_reports(
    user: CurrentUserDep,
    status_filter: Annotated[Literal["all", "open", "resolved"], Query(alias="status")] = "all",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: str | None = None,
) -> ReportPage:
    return reports.list_mine(user.sub, status_filter, limit, cursor)


@router.get("/{report_id}")
def get_report(report_id: str, user: CurrentUserDep) -> ReportDetail:
    try:
        return reports.get_detail(report_id, user.sub)
    except reports.ReportNotFound:
        raise _not_found() from None


@router.patch("/{report_id}")
def update_report(report_id: str, body: TicketUpdate, user: CurrentUserDep) -> ReportDetail:
    try:
        if body.nola311_ticket:
            return reports.set_ticket(report_id, user.sub, body.nola311_ticket)
        if body.dismiss_ticket_suggestion:
            return reports.dismiss_ticket_suggestion(report_id, user.sub)
    except reports.ReportNotFound:
        raise _not_found() from None
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to update")


@router.post("/{report_id}/refresh")
def refresh_report(report_id: str, user: CurrentUserDep) -> ReportDetail:
    """Check the City's data for progress now (throttled to once every 10 minutes)."""
    try:
        return reports.refresh_city_status(report_id, user.sub)
    except reports.ReportNotFound:
        raise _not_found() from None
    except reports.NoTicket:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Add the NOLA 311 request number first"
        ) from None


@router.post("/{report_id}/support", status_code=status.HTTP_201_CREATED)
def add_support(report_id: str, body: SupportRequest, user: CurrentUserDep) -> SupportResult:
    try:
        count = reports.support(report_id, user.sub, body.draft_id)
    except (reports.ReportNotFound, drafts.DraftNotFound):
        raise _not_found() from None
    except reports.CannotSupport as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    return SupportResult(report_id=report_id, supporter_count=count)
