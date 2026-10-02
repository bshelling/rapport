"""Fresh data right after a submission: live Rapport numbers, on-demand City progress."""

import pytest

from app.config import get_settings
from app.services import nola311, reports, stats
from tests.conftest import dev_headers
from tests.helpers import submit_report

ME = dev_headers("user-1", "user-1@example.com")
TICKET = "2026-1320614"


def city_row(status="Pending", created="2026-09-19T13:21:50.000", modified=None):
    """Shape of the real data.nola.gov row for this request."""
    return {
        "service_request": TICKET,
        "request_type": "Roads and Streets",
        "request_reason": "Pothole",
        "request_status": status,
        "date_created": created,
        "date_modified": modified or created,
        "final_address": "3610 Toulouse St",
        "latitude": "29.975357872128765",
        "longitude": "-90.09281204620228",
    }


@pytest.fixture
def live(monkeypatch):
    """Live City mode, with the City's answer controlled by the test."""
    monkeypatch.setenv("RAPPORT_NOLA311_MODE", "live")
    get_settings.cache_clear()
    monkeypatch.setattr(nola311, "nearest_basin", lambda lat, lng: None)
    monkeypatch.setattr(nola311, "open_requests_near", lambda *a, **k: [])
    answers = {"row": city_row(), "calls": 0}

    def fetch_ticket(ticket, timeout=4.0):
        answers["calls"] += 1
        return answers["row"] if ticket == TICKET else None

    monkeypatch.setattr(nola311, "fetch_ticket", fetch_ticket)
    return answers


def linked_report(client):
    report = submit_report(client, reason=("Roads and Streets", "Pothole"))
    res = client.patch(f"/api/reports/{report['id']}", json={"nola311_ticket": TICKET}, headers=ME)
    assert res.status_code == 200
    return report["id"]


def refresh(client, report_id, headers=ME):
    return client.post(f"/api/reports/{report_id}/refresh", headers=headers)


def allow_next_check(report_id, table):
    """Pretend the last City check was long ago (the check is throttled)."""
    table.update_item(
        Key={"PK": f"REPORT#{report_id}", "SK": "META"},
        UpdateExpression="SET city_checked_at = :t",
        ExpressionAttributeValues={":t": "2026-01-01T00:00:00+00:00"},
    )


def test_new_reports_count_right_away(client, monkeypatch):
    monkeypatch.setattr(stats, "load_neighborhoods", lambda: [])
    monkeypatch.setattr(stats, "basins_by_neighborhood", dict)
    monkeypatch.setattr(stats, "median_days_to_close", lambda since: {})
    monkeypatch.setattr(stats, "_count", lambda where: 0)
    stats.compute()  # last night's numbers: no reports yet
    assert client.get("/api/stats").json()["rapport"]["reports"] == 0

    submit_report(client)
    assert client.get("/api/stats").json()["rapport"]["reports"] == 1  # not tomorrow


def test_the_playwright_user_is_excluded_from_live_numbers(client, table):
    report = submit_report(client)
    table.update_item(
        Key={"PK": f"REPORT#{report['id']}", "SK": "META"},
        UpdateExpression="SET contact.email = :e",
        ExpressionAttributeValues={":e": "e2e@example.com"},
    )
    assert stats.rapport_numbers()["reports"] == 0


def test_refresh_follows_the_city_through_to_resolved(client, table, live):
    report_id = linked_report(client)  # linking verifies live: City row is Pending
    detail = refresh(client, report_id).json()
    assert detail["status"] == "filed_with_311" and detail["city_checked_at"]

    live["row"] = city_row(modified="2026-09-25T09:00:00.000")  # City touched it
    allow_next_check(report_id, table)
    detail = refresh(client, report_id).json()
    assert detail["status"] == "in_progress"
    assert detail["events"][-1]["source"] == "nola311"

    live["row"] = city_row(status="Closed", modified="2026-10-01T09:00:00.000")
    allow_next_check(report_id, table)
    detail = refresh(client, report_id).json()
    assert detail["status"] == "resolved"
    assert detail["events"][-1]["note"] == f"NOLA 311 closed request #{TICKET}"
    assert detail["nola311_verified"] is True


def test_refresh_is_throttled(client, live):
    report_id = linked_report(client)
    calls = live["calls"]
    refresh(client, report_id)
    refresh(client, report_id)
    assert live["calls"] == calls + 1  # the second check within 10 minutes is skipped


def test_refresh_is_for_the_owner_of_a_linked_report(client, live):
    report_id = linked_report(client)
    other = dev_headers("user-2", "user-2@example.com")
    assert refresh(client, report_id, other).status_code == 404
    assert client.get(f"/api/reports/{report_id}", headers=other).json()["city_checked_at"] is None
    unlinked = submit_report(client)["id"]
    assert refresh(client, unlinked).status_code == 409


def test_the_city_being_down_never_breaks_the_page(client, monkeypatch, live):
    report_id = linked_report(client)

    def down(ticket, timeout=4.0):
        raise TimeoutError

    monkeypatch.setattr(nola311, "fetch_ticket", down)
    res = refresh(client, report_id)
    assert res.status_code == 200 and res.json()["status"] == "filed_with_311"


def test_throttle_window_is_ten_minutes():
    assert reports.CITY_CHECK_INTERVAL.total_seconds() == 600
