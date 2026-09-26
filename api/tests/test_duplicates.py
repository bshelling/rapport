from datetime import UTC, datetime, timedelta

import boto3
import pytest

from app.geo import geohash, geohash_bounds
from app.services import duplicates, jev
from tests.conftest import BUCKET, dev_headers
from tests.helpers import CONTACT, DESCRIPTION, submit_report

ALEX = dev_headers("user-1", "user-1@example.com")
BLAIR = dev_headers("user-2", "user-2@example.com")
BASE = {"lat": 29.9212, "lng": -90.1027}


@pytest.fixture(autouse=True)
def fake_jev():
    jev.get_jev.cache_clear()
    yield
    jev.get_jev.cache_clear()


def _draft(client, headers, reason=("Drainage", "Catch Basin Clogged"), location=BASE):
    draft_id = client.post("/api/drafts", headers=headers).json()["id"]
    body = {"request_type": reason[0], "request_reason": reason[1]}
    client.patch(f"/api/drafts/{draft_id}", json=body, headers=headers)
    res = client.patch(f"/api/drafts/{draft_id}", json={"location": location}, headers=headers)
    return res.json()["id"]


def _dupes(client, draft_id, headers):
    return client.get(f"/api/drafts/{draft_id}", headers=headers).json()["duplicates"]


def _set(table, report_id, **attrs):
    names = {f"#{k}": k for k in attrs}
    table.update_item(
        Key={"PK": f"REPORT#{report_id}", "SK": "META"},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in attrs),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues={f":{k}": v for k, v in attrs.items()},
    )


def test_setting_location_finds_the_nearby_report(client):
    existing = submit_report(client, user="user-1")
    draft_id = _draft(client, BLAIR, location={"lat": 29.92125, "lng": -90.10272})  # ~6 m
    d = _dupes(client, draft_id, BLAIR)
    assert d["status"] == "done"
    [m] = d["matches"]
    assert m["report_id"] == existing["id"]
    assert m["distance_m"] < 10 and m["probability"] == 0.9
    assert m["is_mine"] is False


def test_different_reason_or_far_away_is_not_a_duplicate(client):
    submit_report(client, user="user-1")
    other_reason = _draft(client, BLAIR, reason=("Drainage", "Street Flooding"))
    assert _dupes(client, other_reason, BLAIR)["matches"] == []
    far = _draft(client, BLAIR, location={"lat": 29.9220, "lng": -90.1027})  # ~90 m north
    assert _dupes(client, far, BLAIR)["matches"] == []


def test_other_type_old_and_closed_reports_are_ignored(client, table):
    pothole = submit_report(client, user="user-1", reason=("Roads and Streets", "Pothole"))
    old = submit_report(client, user="user-1")
    closed = submit_report(client, user="user-1")
    long_ago = (datetime.now(UTC) - timedelta(days=120)).isoformat(timespec="seconds")
    _set(table, old["id"], GSI2SK=f"TYPE#Drainage#{long_ago}", created_at=long_ago)
    _set(table, closed["id"], status="resolved")
    found = {i["id"] for _, i in duplicates.nearby("Drainage", BASE["lat"], BASE["lng"])}
    assert pothole["id"] not in found and old["id"] not in found and closed["id"] not in found


def test_nearby_crosses_geohash_cell_edges(client, table):
    # Put the existing report just across the east edge of the draft's cell.
    min_lat, min_lng, max_lat, max_lng = geohash_bounds(geohash(BASE["lat"], BASE["lng"], 6))
    lat = (min_lat + max_lat) / 2
    inside = {"lat": lat, "lng": max_lng - 0.0002}
    outside_cell = {"lat": lat, "lng": max_lng + 0.0002}  # ~40 m away, next cell
    assert geohash(inside["lat"], inside["lng"], 6) != geohash(**outside_cell, precision=6)
    report = submit_report(client, user="user-1")
    _set(
        table,
        report["id"],
        GSI2PK=f"GEO#{geohash(outside_cell['lat'], outside_cell['lng'], 6)}",
        location={"lat": str(outside_cell["lat"]), "lng": str(outside_cell["lng"])},
    )
    found = [i["id"] for _, i in duplicates.nearby("Drainage", inside["lat"], inside["lng"])]
    assert found == [report["id"]]


def test_moving_the_pin_rechecks(client):
    existing = submit_report(client, user="user-1")
    draft_id = _draft(client, BLAIR, location={"lat": 29.9230, "lng": -90.1027})  # ~200 m
    assert _dupes(client, draft_id, BLAIR)["matches"] == []
    client.patch(f"/api/drafts/{draft_id}", json={"location": BASE}, headers=BLAIR)
    assert _dupes(client, draft_id, BLAIR)["matches"][0]["report_id"] == existing["id"]


def test_own_report_is_flagged(client):
    submit_report(client, user="user-1")
    draft_id = _draft(client, ALEX)
    assert _dupes(client, draft_id, ALEX)["matches"][0]["is_mine"] is True


# --- +1 ------------------------------------------------------------------------------


def test_support_once_and_not_your_own(client):
    report = submit_report(client, user="user-1")
    url = f"/api/reports/{report['id']}/support"
    res = client.post(url, json={}, headers=BLAIR)
    assert res.status_code == 201 and res.json()["supporter_count"] == 1
    again = client.post(url, json={}, headers=BLAIR)
    assert again.status_code == 409 and "already" in again.json()["detail"]
    own = client.post(url, json={}, headers=ALEX)
    assert own.status_code == 409 and "You reported" in own.json()["detail"]
    assert client.post("/api/reports/NOPE/support", json={}, headers=BLAIR).status_code == 404
    detail = client.get(f"/api/reports/{report['id']}", headers=BLAIR).json()
    assert detail["supporter_count"] == 1 and detail["supported_by_me"] is True


def test_closed_reports_cannot_be_supported(client, table):
    report = submit_report(client, user="user-1")
    _set(table, report["id"], status="resolved")
    res = client.post(f"/api/reports/{report['id']}/support", json={}, headers=BLAIR)
    assert res.status_code == 409


def test_support_from_a_draft_folds_it_in(client, table):
    report = submit_report(client, user="user-1")
    draft_id = _draft(client, BLAIR)
    for body in ({"contact": CONTACT}, {"description_html": DESCRIPTION}):
        client.patch(f"/api/drafts/{draft_id}", json=body, headers=BLAIR)
    photo = client.post(f"/api/drafts/{draft_id}/photos", json={}, headers=BLAIR).json()["photo"]
    boto3.client("s3").put_object(Bucket=BUCKET, Key=photo["key"], Body=b"\xff\xd8" + b"0" * 2048)

    res = client.post(
        f"/api/reports/{report['id']}/support", json={"draft_id": draft_id}, headers=BLAIR
    )
    assert res.status_code == 201
    assert client.get(f"/api/drafts/{draft_id}", headers=BLAIR).status_code == 404
    support = table.get_item(Key={"PK": f"REPORT#{report['id']}", "SK": "SUPPORT#user-2"})["Item"]
    assert support["photo_key"] == f"reports/{report['id']}/support/{photo['id']}.jpg"
    assert support["photo_public"] is False  # not screened by triage
    keys = [o["Key"] for o in boto3.client("s3").list_objects_v2(Bucket=BUCKET)["Contents"]]
    assert support["photo_key"] in keys and photo["key"] not in keys


def test_someone_elses_draft_cannot_be_used(client):
    report = submit_report(client, user="user-1")
    draft_id = _draft(client, ALEX)
    res = client.post(
        f"/api/reports/{report['id']}/support", json={"draft_id": draft_id}, headers=BLAIR
    )
    assert res.status_code == 404


def test_typesafe_same_issue_mapping():
    from typesafe_sdk import SystemOneResponse

    fake = SystemOneResponse.model_validate(
        {
            "model": "jev",
            "usage": {},
            "answers": {"same_issue": {"type": "noul", "noul": 0.83}},
        }
    )
    j = jev.TypeSafeJev.__new__(jev.TypeSafeJev)
    seen = {}

    def system_one(state, questions):
        seen.update(state=state, questions=questions)
        return fake

    j.client = type("C", (), {"system_one": staticmethod(system_one)})()
    assert j.same_issue({"reason": "Pothole"}, {"reason": "Pothole", "distance_m": 12}) == 0.83
    assert '"existing_report"' in seen["state"] and list(seen["questions"]) == ["same_issue"]
