from tests.conftest import dev_headers
from tests.helpers import submit_report

ME = dev_headers("user-1", "user-1@example.com")
OTHER = dev_headers("user-2", "user-2@example.com")


def _set_status(table, report_id, status):
    table.update_item(
        Key={"PK": f"REPORT#{report_id}", "SK": "META"},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": status},
    )


def test_my_reports_requires_sign_in(client):
    assert client.get("/api/reports/mine").status_code == 401


def test_my_reports_newest_first_and_only_mine(client):
    first = submit_report(client)
    second = submit_report(client, reason=("Roads and Streets", "Pothole"), photo=True)
    submit_report(client, user="user-2")

    page = client.get("/api/reports/mine", headers=ME).json()
    assert [r["id"] for r in page["reports"]] == [second["id"], first["id"]]
    assert page["next_cursor"] is None
    top = page["reports"][0]
    assert top["request_reason"] == "Pothole"
    assert top["address"] == "Napoleon Ave & Magazine St"
    assert top["photo_count"] == 1 and top["thumbnail_url"].startswith("https://")
    assert page["reports"][1]["thumbnail_url"] is None


def test_status_filters(client, table):
    a = submit_report(client)
    b = submit_report(client)
    _set_status(table, a["id"], "resolved")

    def ids(status):
        page = client.get(f"/api/reports/mine?status={status}", headers=ME).json()
        return [r["id"] for r in page["reports"]]

    assert ids("resolved") == [a["id"]]
    assert ids("open") == [b["id"]]
    assert set(ids("all")) == {a["id"], b["id"]}
    assert client.get("/api/reports/mine?status=bogus", headers=ME).status_code == 422


def test_pagination(client):
    reports = [submit_report(client)["id"] for _ in range(3)]
    seen, cursor = [], None
    while True:
        url = "/api/reports/mine?limit=2" + (f"&cursor={cursor}" if cursor else "")
        page = client.get(url, headers=ME).json()
        seen += [r["id"] for r in page["reports"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == list(reversed(reports))
    # A garbage cursor falls back to the first page instead of erroring.
    assert client.get("/api/reports/mine?cursor=%%%", headers=ME).status_code == 200


def test_owner_sees_full_detail(client):
    report = submit_report(client, photo=True)
    detail = client.get(f"/api/reports/{report['id']}", headers=ME).json()
    assert detail["is_owner"] is True
    assert detail["contact"]["last_name"] == "Robichaux"
    assert len(detail["photos"]) == 1 and detail["photos"][0]["url"].startswith("https://")
    assert [e["status"] for e in detail["events"]] == ["submitted"]
    assert detail["events"][0]["source"] == "user"
    assert detail["location"]["lat"] == 29.9212


def test_others_get_a_redacted_view(client):
    report = submit_report(client, photo=True)
    detail = client.get(f"/api/reports/{report['id']}", headers=OTHER).json()
    assert detail["is_owner"] is False
    assert detail["contact"] is None
    assert detail["photos"] == []
    assert detail["request_reason"] == "Catch Basin Clogged"


def test_unknown_report_is_404(client):
    assert client.get("/api/reports/NOPE", headers=ME).status_code == 404


def test_set_311_ticket(client, table):
    rid = submit_report(client)["id"]
    url = f"/api/reports/{rid}"
    assert client.patch(url, json={"nola311_ticket": "12345"}, headers=ME).status_code == 422
    assert (
        client.patch(url, json={"nola311_ticket": "2026-1322736"}, headers=OTHER).status_code == 404
    )

    res = client.patch(url, json={"nola311_ticket": " 2026-1322736 "}, headers=ME)
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["status"] == "filed_with_311"
    assert detail["nola311_ticket"] == "2026-1322736"
    assert [e["status"] for e in detail["events"]] == ["submitted", "filed_with_311"]
    assert detail["events"][-1]["note"] == "Filed with NOLA 311 as 2026-1322736"

    # Saving the same ticket again doesn't add another timeline entry.
    again = client.patch(url, json={"nola311_ticket": "2026-1322736"}, headers=ME).json()
    assert len(again["events"]) == 2


def test_ticket_does_not_move_status_backwards(client, table):
    rid = submit_report(client)["id"]
    _set_status(table, rid, "in_progress")
    res = client.patch(f"/api/reports/{rid}", json={"nola311_ticket": "2026-0000123"}, headers=ME)
    assert res.json()["status"] == "in_progress"
