import boto3

from tests.conftest import BUCKET, dev_headers

CONTACT = {
    "first_name": "Alex",
    "last_name": "Robichaux",
    "email": "alex@example.com",
    "phone": "504-555-0100",
    "phone_type": "mobile",
}
LOCATION = {"lat": 29.9212, "lng": -90.1027, "address": "Napoleon Ave & Magazine St"}
DESCRIPTION = "<p>Catch basin is <strong>full of leaves</strong>.</p>"


def submit_report(client, user="user-1", reason=("Drainage", "Catch Basin Clogged"), photo=False):
    headers = dev_headers(user, f"{user}@example.com")
    draft_id = client.post("/api/drafts", headers=headers).json()["id"]
    for body in (
        {"step": 1, "request_type": reason[0], "request_reason": reason[1]},
        {"step": 2, "contact": CONTACT},
        {"step": 3, "location": LOCATION, "description_html": DESCRIPTION},
    ):
        assert (
            client.patch(f"/api/drafts/{draft_id}", json=body, headers=headers).status_code == 200
        )
    if photo:
        p = client.post(f"/api/drafts/{draft_id}/photos", json={}, headers=headers).json()["photo"]
        boto3.client("s3").put_object(Bucket=BUCKET, Key=p["key"], Body=b"\xff\xd8" + b"0" * 2048)
    res = client.post(f"/api/drafts/{draft_id}/submit", headers=headers)
    assert res.status_code == 201, res.text
    return res.json()
