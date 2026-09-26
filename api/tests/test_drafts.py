import boto3
import pytest

from tests.conftest import BUCKET, dev_headers

ME = dev_headers("user-1")
OTHER = dev_headers("user-2", "b@example.com")
CONTACT = {
    "first_name": "Alex",
    "last_name": "Robichaux",
    "email": "alex@example.com",
    "phone": "504-555-0100",
    "phone_type": "mobile",
}
LOCATION = {"lat": 29.9212, "lng": -90.1027, "address": "Napoleon Ave & Magazine St"}
DESCRIPTION = "<p>Catch basin is <strong>full of leaves</strong>.</p>"


@pytest.fixture
def draft(client):
    res = client.post("/api/drafts", headers=ME)
    assert res.status_code == 201
    return res.json()


def _patch(client, draft_id, body, headers=ME):
    return client.patch(f"/api/drafts/{draft_id}", json=body, headers=headers)


def _complete(client, draft_id):
    for body in (
        {"step": 1, "request_type": "Drainage", "request_reason": "Catch Basin Clogged"},
        {"step": 2, "contact": CONTACT},
        {"step": 3, "location": LOCATION, "description_html": DESCRIPTION},
    ):
        assert _patch(client, draft_id, body).status_code == 200


def test_drafts_require_sign_in(client):
    assert client.post("/api/drafts").status_code == 401


def test_create_and_get_own_draft(client, draft):
    assert draft["step"] == 1 and draft["photos"] == []
    res = client.get(f"/api/drafts/{draft['id']}", headers=ME)
    assert res.status_code == 200 and res.json()["id"] == draft["id"]


def test_other_users_cannot_see_or_change_a_draft(client, draft):
    url = f"/api/drafts/{draft['id']}"
    assert client.get(url, headers=OTHER).status_code == 404
    assert _patch(client, draft["id"], {"step": 2}, OTHER).status_code == 404
    assert client.post(f"{url}/photos", json={}, headers=OTHER).status_code == 404
    assert client.post(f"{url}/submit", headers=OTHER).status_code == 404


def test_step_updates_are_saved(client, draft):
    _complete(client, draft["id"])
    saved = client.get(f"/api/drafts/{draft['id']}", headers=ME).json()
    assert saved["step"] == 3
    assert saved["request_reason"] == "Catch Basin Clogged"
    assert saved["contact"]["phone"] == "5045550100"
    assert saved["location"]["lat"] == pytest.approx(29.9212)


def test_changing_type_clears_reason(client, draft):
    _patch(client, draft["id"], {"request_type": "Drainage", "request_reason": "Street Flooding"})
    res = _patch(client, draft["id"], {"request_type": "Roads and Streets"})
    assert res.json()["request_reason"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"request_type": "Parks"},
        {"request_type": "Roads and Streets", "request_reason": "Street Flooding"},
        {"location": {"lat": 30.4515, "lng": -91.1871}},  # Baton Rouge
        {"contact": {**CONTACT, "phone": "12"}},
        {"step": 4},
    ],
)
def test_invalid_updates_are_rejected(client, draft, body):
    assert _patch(client, draft["id"], body).status_code == 422


def test_description_is_sanitized(client, draft):
    res = _patch(client, draft["id"], {"description_html": "<p>ok<script>x</script></p>"})
    assert res.json()["description_html"] == "<p>ok</p>"


def test_photo_upload_is_presigned_and_limited(client, draft):
    url = f"/api/drafts/{draft['id']}/photos"
    first = client.post(url, json={}, headers=ME).json()
    assert first["photo"]["key"] == f"drafts/{draft['id']}/{first['photo']['id']}.jpg"
    assert first["fields"]["Content-Type"] == "image/jpeg"
    assert first["max_bytes"] == 8 * 1024 * 1024
    client.post(url, json={}, headers=ME)
    client.post(url, json={}, headers=ME)
    fourth = client.post(url, json={}, headers=ME)
    assert fourth.status_code == 409
    assert len(client.get(f"/api/drafts/{draft['id']}", headers=ME).json()["photos"]) == 3


def test_remove_photo(client, draft):
    url = f"/api/drafts/{draft['id']}/photos"
    photo = client.post(url, json={}, headers=ME).json()["photo"]
    res = client.delete(f"{url}/{photo['id']}", headers=ME)
    assert res.status_code == 200 and res.json()["photos"] == []
    assert client.delete(f"{url}/{photo['id']}", headers=ME).status_code == 404


def test_submit_incomplete_draft_lists_missing_fields(client, draft):
    res = client.post(f"/api/drafts/{draft['id']}/submit", headers=ME)
    assert res.status_code == 422
    assert set(res.json()["detail"]["missing"]) == {
        "request_reason",
        "contact",
        "location",
        "description",
    }


def test_submit_requires_reserved_photos_to_be_uploaded(client, draft):
    _complete(client, draft["id"])
    client.post(f"/api/drafts/{draft['id']}/photos", json={}, headers=ME)
    res = client.post(f"/api/drafts/{draft['id']}/submit", headers=ME)
    assert res.status_code == 422
    assert res.json()["detail"]["missing"] == ["photos"]


def test_submit_creates_report_and_moves_photos(client, draft, table):
    _complete(client, draft["id"])
    photo = client.post(f"/api/drafts/{draft['id']}/photos", json={}, headers=ME).json()["photo"]
    s3 = boto3.client("s3")
    s3.put_object(Bucket=BUCKET, Key=photo["key"], Body=b"\xff\xd8" + b"0" * 2048)

    res = client.post(f"/api/drafts/{draft['id']}/submit", headers=ME)
    assert res.status_code == 201, res.text
    report = res.json()
    rid = report["id"]
    assert report["status"] == "submitted"
    assert report["photo_keys"] == [f"reports/{rid}/{photo['id']}.jpg"]

    item = table.get_item(Key={"PK": f"REPORT#{rid}", "SK": "META"})["Item"]
    assert item["GSI1PK"] == "USER#user-1"
    assert item["GSI2PK"] == "GEO#9vrfjw"
    assert item["GSI2SK"].startswith("TYPE#Drainage#")
    assert item["contact"]["last_name"] == "Robichaux"
    events = table.query(
        KeyConditionExpression="PK = :p AND begins_with(SK, :e)",
        ExpressionAttributeValues={":p": f"REPORT#{rid}", ":e": "EVENT#"},
    )["Items"]
    assert [e["status"] for e in events] == ["submitted"]

    # Draft is gone and the photo moved out of drafts/.
    assert "Item" not in table.get_item(Key={"PK": f"DRAFT#{draft['id']}", "SK": "META"})
    keys = [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]
    assert keys == [f"reports/{rid}/{photo['id']}.jpg"]
    assert client.get(f"/api/drafts/{draft['id']}", headers=ME).status_code == 404
