from datetime import UTC, datetime, timedelta

import pytest

from app.config import get_settings
from app.services import ingest, jev, nola311
from tests.conftest import dev_headers
from tests.helpers import submit_report

ME = dev_headers("user-1", "user-1@example.com")


def row(ticket="2026-1322723", reason="Catch Basin Clogged", status="Pending", **kw):
    """Shape of a real data.nola.gov 2jgv-pqrq row."""
    return {
        "service_request": ticket,
        "request_type": "Drainage",
        "request_reason": reason,
        "date_created": kw.get("created", "2026-09-25T19:41:47.000"),
        "date_modified": kw.get("modified", "2026-09-25T19:41:50.000"),
        "request_status": status,
        "final_address": "4000 Magazine St",
        "address_councildis": "B",
        "latitude": str(kw.get("lat", 29.92121)),
        "longitude": str(kw.get("lng", -90.10271)),
    }


def set_ticket(client, report_id, body):
    return client.patch(f"/api/reports/{report_id}", json=body, headers=ME).json()


def status_of(modified, status="Pending"):
    return ingest.city_status(
        {
            "id": "t",
            "created_at": "2026-09-01T10:00:00",
            "request_status": status,
            "modified_at": modified,
        }
    )


@pytest.fixture(autouse=True)
def fake_jev():
    jev.get_jev.cache_clear()
    yield
    jev.get_jev.cache_clear()


def test_to_item_mapping():
    item = nola311.to_item(row())
    assert item["PK"] == "NOLA311#2026-1322723" and item["source"] == "nola311"
    assert item["request_type"] == "Drainage" and item["status"] == "filed_with_311"
    assert item["GSI2PK"] == "GEO#9vrfjw" and item["GSI3PK"] == "MAP311"
    assert item["created_at"] == "2026-09-25T19:41:47"
    closed = nola311.to_item(row(status="Closed"))
    assert closed["status"] == "resolved" and "GSI3PK" not in closed
    assert nola311.to_item(row(reason="Illegal Dumping")) is None
    assert nola311.to_item(row(lat=30.45, lng=-91.18)) is None  # Baton Rouge
    assert nola311.to_item({**row(), "latitude": None}) is None


def test_city_status():
    base = {"id": "t", "created_at": "2026-09-01T10:00:00"}
    assert (
        ingest.city_status(
            {**base, "request_status": "Pending", "modified_at": "2026-09-01T10:00:05"}
        )
        == "filed_with_311"
    )
    assert (
        ingest.city_status(
            {**base, "request_status": "Pending", "modified_at": "2026-09-03T09:00:00"}
        )
        == "in_progress"
    )
    assert (
        ingest.city_status(
            {**base, "request_status": "Closed", "modified_at": "2026-09-01T10:00:05"}
        )
        == "resolved"
    )


def test_backfill_then_incremental(client, table, monkeypatch):
    calls = []

    def fake_fetch(field, since):
        calls.append((field, since))
        if field == "date_created":
            return iter(
                [
                    row("2026-0000001"),
                    row("2026-0000002", reason="Pothole"),
                    row("x", reason="Graffiti"),
                ]
            )
        return iter([row("2026-0000001", status="Closed", modified="2026-09-27T08:00:00.000")])

    monkeypatch.setattr(nola311, "fetch_since", fake_fetch)
    first = ingest.run()
    assert (first["upserted"], first["skipped"]) == (2, 1)
    assert calls[0][0] == "date_created"
    city = table.get_item(Key={"PK": "NOLA311#2026-0000002", "SK": "META"})["Item"]
    assert city["request_type"] == "Roads and Streets"

    second = ingest.run()  # uses the stored watermark
    assert calls[1] == ("date_modified", "2026-09-25T19:41:50")
    assert second["upserted"] == 1 and second["watermark"] == "2026-09-27T08:00:00"
    closed = table.get_item(Key={"PK": "NOLA311#2026-0000001", "SK": "META"})["Item"]
    assert closed["status"] == "resolved" and "GSI3PK" not in closed


def test_linked_report_follows_the_city(client, table, monkeypatch):
    report = submit_report(client)
    client.patch(
        f"/api/reports/{report['id']}", json={"nola311_ticket": "2026-1322723"}, headers=ME
    )
    rows = iter(
        [
            row(modified="2026-09-27T09:00:00.000"),
            row(status="Closed", modified="2026-09-28T09:00:00.000"),
        ]
    )
    monkeypatch.setattr(nola311, "fetch_since", lambda field, since: iter([next(rows)]))

    assert ingest.run()["synced"] == 1
    detail = client.get(f"/api/reports/{report['id']}", headers=ME).json()
    assert detail["status"] == "in_progress"
    assert detail["events"][-1]["source"] == "nola311"

    ingest.run()
    detail = client.get(f"/api/reports/{report['id']}", headers=ME).json()
    assert detail["status"] == "resolved"
    assert detail["events"][-1]["note"] == "NOLA 311 closed request #2026-1322723"
    assert [e["status"] for e in detail["events"]] == [
        "submitted",
        "filed_with_311",
        "in_progress",
        "resolved",
    ]


def test_saving_a_ticket_verifies_it_live(client, monkeypatch):
    monkeypatch.setenv("RAPPORT_NOLA311_MODE", "live")
    get_settings.cache_clear()
    report = submit_report(client)
    monkeypatch.setattr(
        nola311,
        "fetch_ticket",
        lambda t: row(ticket=t, status="Closed") if t == "2026-1322723" else None,
    )

    known = client.patch(
        f"/api/reports/{report['id']}", json={"nola311_ticket": "2026-1322723"}, headers=ME
    ).json()
    assert known["nola311_verified"] is True and known["status"] == "resolved"

    other = submit_report(client)
    unknown = client.patch(
        f"/api/reports/{other['id']}", json={"nola311_ticket": "2026-9999999"}, headers=ME
    ).json()
    assert unknown["nola311_verified"] is False and unknown["status"] == "filed_with_311"


def test_changing_the_ticket_moves_the_pointer(client, table):
    report = submit_report(client)
    url = f"/api/reports/{report['id']}"
    client.patch(url, json={"nola311_ticket": "2026-0000001"}, headers=ME)
    client.patch(url, json={"nola311_ticket": "2026-0000002"}, headers=ME)
    assert ingest.linked_reports("2026-0000001") == []
    assert ingest.linked_reports("2026-0000002") == [report["id"]]


def test_link_suggestion_and_dismiss(client, table, monkeypatch):
    report = submit_report(client)  # Catch Basin Clogged at 29.9212, -90.1027, today
    today = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000")
    monkeypatch.setattr(
        nola311,
        "fetch_since",
        lambda field, since: iter(
            [
                row("2026-5550001", created=today, modified=today),  # ~1 m away, same reason
                row("2026-5550002", reason="Street Flooding", created=today, modified=today),
            ]
        ),
    )
    assert ingest.run()["suggested"] == 1
    detail = client.get(f"/api/reports/{report['id']}", headers=ME).json()
    assert detail["suggested_ticket"]["ticket"] == "2026-5550001"
    assert (
        client.get(f"/api/reports/{report['id']}", headers=dev_headers("user-2")).json()[
            "suggested_ticket"
        ]
        is None
    )  # owner only

    res = client.patch(
        f"/api/reports/{report['id']}", json={"dismiss_ticket_suggestion": True}, headers=ME
    )
    assert res.json()["suggested_ticket"] is None
    assert ingest.suggest_links() == 0  # not suggested again


def test_old_or_far_city_requests_are_not_suggested(client, monkeypatch):
    submit_report(client)
    old = (datetime.now(UTC) - timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S.000")
    monkeypatch.setattr(
        nola311,
        "fetch_since",
        lambda field, since: iter(
            [row("2026-5550003", created=old, modified=old), row("2026-5550004", lat=29.9230)]
        ),
    )
    assert ingest.run()["suggested"] == 0


def test_city_requests_count_as_duplicates_and_map_pins(client, monkeypatch):
    monkeypatch.setattr(nola311, "fetch_since", lambda field, since: iter([row()]))
    ingest.run()
    draft_id = client.post("/api/drafts", headers=ME).json()["id"]
    client.patch(
        f"/api/drafts/{draft_id}",
        json={"request_type": "Drainage", "request_reason": "Catch Basin Clogged"},
        headers=ME,
    )
    client.patch(
        f"/api/drafts/{draft_id}", json={"location": {"lat": 29.9212, "lng": -90.1027}}, headers=ME
    )
    [match] = client.get(f"/api/drafts/{draft_id}", headers=ME).json()["duplicates"]["matches"]
    assert match["source"] == "nola311" and match["nola311_ticket"] == "2026-1322723"

    body = client.get("/api/map/reports?include_city=true").json()
    assert body["reports"] == [] and [c["id"] for c in body["city"]] == ["2026-1322723"]
    assert body["city"][0]["source"] == "nola311"
    assert client.get("/api/map/reports").json()["city"] == []
