"""Sample (demo) data: labeled, kept out of Rapport's numbers and duplicate checks."""

import importlib.util
import sys
from pathlib import Path

import pytest

from app.services import duplicates, ingest, stats
from tests.conftest import dev_headers

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "seed-demo.py"
OWNER = "demo-sub"


@pytest.fixture
def seed(table, monkeypatch):
    spec = importlib.util.spec_from_file_location("seed_demo", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "table_for", lambda env: table)

    def run(*args: str) -> None:
        monkeypatch.setattr(sys, "argv", ["seed-demo.py", "local", *args])
        module.main()

    return module, run


def _meta(table, rid):
    return table.get_item(Key={"PK": f"REPORT#{rid}", "SK": "META"}).get("Item")


def test_seed_creates_labeled_reports_and_keeps_existing_ones(seed, table, capsys):
    module, run = seed
    run("--owner", OWNER)
    assert f"created {len(module.REPORTS)}" in capsys.readouterr().out
    first = _meta(table, "sample01")
    assert first["sample"] is True and first["user_sub"] == OWNER

    # A later nightly sync moved one on; re-running the seed keeps that.
    table.update_item(
        Key={"PK": "REPORT#sample02", "SK": "META"},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "resolved"},
    )
    run("--owner", OWNER)
    assert "created 0" in capsys.readouterr().out
    assert _meta(table, "sample02")["status"] == "resolved"

    run("--remove")
    assert _meta(table, "sample01") is None
    assert (
        table.get_item(Key={"PK": "TICKET#2026-1316662", "SK": "REPORT#sample01"}).get("Item")
        is None
    )


def test_linked_samples_follow_the_city_status_rules(seed, table):
    _, run = seed
    run("--owner", OWNER)
    # Closed City request: resolved, with the City's closing event.
    assert _meta(table, "sample01")["status"] == "resolved"
    # Pending and touched later than filing: in progress.
    assert _meta(table, "sample03")["status"] == "in_progress"
    # Pending, untouched: filed.
    assert _meta(table, "sample02")["status"] == "filed_with_311"
    # Nightly sync can find linked samples by ticket.
    assert table.get_item(Key={"PK": "TICKET#2026-1322723", "SK": "REPORT#sample02"})["Item"]
    # Not linked: submitted.
    assert _meta(table, "sample06")["status"] == "submitted"


def test_samples_are_labeled_in_the_api(seed, client):
    _, run = seed
    run("--owner", "user-1")  # dev_headers() signs in as user-1
    pins = client.get("/api/map/reports").json()["reports"]
    assert pins and all(p["sample"] for p in pins)
    mine = client.get("/api/reports/mine", headers=dev_headers()).json()["reports"]
    assert {r["id"] for r in mine} >= {"sample01", "sample06"}
    assert all(r["sample"] for r in mine)
    # Seen by another resident: labeled, and the contact stays private.
    other = dev_headers(sub="someone-else", email="x@example.com")
    detail = client.get("/api/reports/sample01", headers=other).json()
    assert detail["sample"] is True and detail["contact"] is None


def test_samples_do_not_count_or_match(seed, table):
    _, run = seed
    run("--owner", OWNER)
    assert stats.rapport_numbers() == {
        "reports": 0,
        "supporters": 0,
        "filed_with_311": 0,
        "resolved": 0,
    }
    # Right on top of a sample flooding report: no duplicate offered.
    assert duplicates.nearby("Drainage", 29.97607, -90.07833) == []
    # Unlinked samples are never given City request suggestions.
    assert not any(i["id"].startswith("sample") for i in ingest._recent_unlinked_reports())


def test_samples_cannot_be_supported(seed, client):
    _, run = seed
    run("--owner", OWNER)
    res = client.post("/api/reports/sample03/support", json={}, headers=dev_headers())
    assert res.status_code == 409
    assert "sample" in res.json()["detail"]
