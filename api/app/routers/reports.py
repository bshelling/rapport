from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status

from app.auth import CurrentUserDep
from app.models.report import ReportDetail, ReportPage, TicketUpdate
from app.services import reports

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
        return reports.set_ticket(report_id, user.sub, body.nola311_ticket)
    except reports.ReportNotFound:
        raise _not_found() from None
