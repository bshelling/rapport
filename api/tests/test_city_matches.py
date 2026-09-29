"""Before a report is submitted, open City requests for the same problem are checked."""

from datetime import UTC, datetime

import pytest

from app.config import get_settings
from app.services import duplicates, ingest, nola311
from tests.conftest import dev_headers
from tests.helpers import CONTACT, DESCRIPTION, LOCATION

ME = dev_headers("user-1", "user-1@example.com")
TICKET = "2026-1320614"
# ~102 m north of LOCATION: where the City puts "3610 Toulouse St" vs. the resident's pin.
CITY_LAT = LOCATION["lat"] + 0.00092


class RecordingJev:
    """Jev stand-in that records what it's asked; never calls it the same problem."""

    def __init__(self):
        self.calls = []

    def same_issue(self, new, existing):
        self.calls.append((new, existing))
        return 0.1


@pytest.fixture
def jev(monkeypatch):
    # The real Jev answers "same spot?" and says no at ~100 m (0.1 for the real
    # Toulouse St pair), so same-reason City requests must not depend on it.
    fake = RecordingJev()
    monkeypatch.setattr(duplicates, "get_jev", lambda: fake)
    return fake


def city_row(ticket=TICKET, reason="Pothole", lat=CITY_LAT, created=None):
    created = created or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000")
    return {
        "service_request": ticket,
        "request_type": "Roads and Streets",
        "request_reason": reason,
        "request_status": "Pending",
        "date_created": created,
        "date_modified": created,
        "final_address": "3610 Toulouse St",
        "latitude": str(lat),
        "longitude": str(LOCATION["lng"]),
    }


def import_city(monkeypatch, *rows):
    monkeypatch.setattr(nola311, "fetch_since", lambda field, since: iter(rows))
    ingest.run()


def pothole_draft(client):
    draft_id = client.post("/api/drafts", headers=ME).json()["id"]
    for body in (
        {"step": 1, "request_type": "Roads and Streets", "request_reason": "Pothole"},
        {"step": 2, "contact": CONTACT},
        {"step": 3, "location": LOCATION, "description_html": DESCRIPTION},
    ):
        assert client.patch(f"/api/drafts/{draft_id}", json=body, headers=ME).status_code == 200
    return draft_id


def submit(client, draft_id, body=None):
    return client.post(f"/api/drafts/{draft_id}/submit", json=body, headers=ME)


def test_a_city_request_across_the_block_stops_submit_until_the_resident_chooses(
    client, monkeypatch, jev
):
    import_city(monkeypatch, city_row())
    draft_id = pothole_draft(client)

    res = submit(client, draft_id)
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "already_reported"
    [match] = detail["matches"]
    assert match["nola311_ticket"] == TICKET and match["source"] == "nola311"
    assert 95 < match["distance_m"] < 110  # would have been missed at the old 75 m
    assert jev.calls == []  # same reason: shown without asking Jev

    assert submit(client, draft_id, {"confirm_new": True}).status_code == 201


def test_a_related_city_request_is_left_to_jev_with_both_addresses(client, monkeypatch, jev):
    # Same type, different reason: could be the same problem, so Jev decides (and here
    # says no), seeing both addresses rather than just the distance.
    import_city(monkeypatch, city_row(reason="Street Subsidence (Sinking)"))
    assert submit(client, pothole_draft(client)).status_code == 201
    new, existing = jev.calls[-1]
    assert new["address"] == LOCATION["address"]
    assert existing["address"] == "3610 Toulouse St"


def test_linking_to_the_city_request_files_the_report(client, monkeypatch, jev):
    import_city(monkeypatch, city_row())
    draft_id = pothole_draft(client)
    report = submit(client, draft_id, {"link_ticket": TICKET})
    assert report.status_code == 201, report.text
    detail = client.get(f"/api/reports/{report.json()['id']}", headers=ME).json()
    assert detail["nola311_ticket"] == TICKET and detail["status"] == "filed_with_311"


def test_bad_link_numbers_are_rejected(client, monkeypatch, jev):
    draft_id = pothole_draft(client)
    assert submit(client, draft_id, {"link_ticket": "not-a-ticket"}).status_code == 422


def test_other_problems_and_far_requests_do_not_stop_submit(client, monkeypatch, jev):
    import_city(
        monkeypatch,
        city_row("2026-0000010", reason="Sidewalk Damaged or Missing"),  # different problem
        city_row("2026-0000011", lat=LOCATION["lat"] + 0.0018),  # ~200 m away
    )
    assert submit(client, pothole_draft(client)).status_code == 201


def test_requests_filed_since_last_night_are_found_live(client, monkeypatch, jev):
    monkeypatch.setenv("RAPPORT_NOLA311_MODE", "live")
    get_settings.cache_clear()
    monkeypatch.setattr(nola311, "nearest_basin", lambda lat, lng: None)
    asked = []

    def live(lat, lng, request_type, radius_m, days):
        asked.append((request_type, radius_m))
        return [nola311.to_item(city_row("2026-1323379"))]

    monkeypatch.setattr(nola311, "open_requests_near", live)
    res = submit(client, pothole_draft(client))  # nothing imported yet
    assert res.status_code == 409
    assert res.json()["detail"]["matches"][0]["nola311_ticket"] == "2026-1323379"
    assert asked == [("Roads and Streets", duplicates.CITY_RADIUS_M)]


def test_the_city_api_being_down_never_blocks_a_report(client, monkeypatch, jev):
    monkeypatch.setenv("RAPPORT_NOLA311_MODE", "live")
    get_settings.cache_clear()
    monkeypatch.setattr(nola311, "nearest_basin", lambda lat, lng: None)

    def down(*args, **kwargs):
        raise TimeoutError

    monkeypatch.setattr(nola311, "open_requests_near", down)
    assert submit(client, pothole_draft(client)).status_code == 201


def test_nightly_suggestions_reach_across_the_block(client, monkeypatch, jev):
    report = submit(client, pothole_draft(client)).json()
    import_city(monkeypatch, city_row())
    detail = client.get(f"/api/reports/{report['id']}", headers=ME).json()
    assert detail["suggested_ticket"]["ticket"] == TICKET  # 102 m: missed at the old 30 m
