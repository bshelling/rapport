"""Nightly NOLA 311 import: mirror City requests, sync linked reports, suggest links."""

import logging
from datetime import UTC, datetime, timedelta

from boto3.dynamodb.conditions import Key

from app.db import from_dynamo, get_table
from app.geo import distance_m, geohash_neighborhood
from app.html import plain_text
from app.services import nola311
from app.services.jev import get_jev

log = logging.getLogger(__name__)

STATE_KEY = {"PK": "INGEST#nola311", "SK": "STATE"}
MATCH_RADIUS_M = 30
MATCH_WINDOW = timedelta(hours=72)
MATCH_THRESHOLD = 0.85
SUGGEST_FOR_DAYS = 7


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


# --- Report status from the City's record -------------------------------------------


def city_status(city: dict) -> str:
    """Rapport status for a report the City tracks as `city`."""
    if city.get("request_status") == "Closed":
        return "resolved"
    created, modified = city.get("created_at"), city.get("modified_at")
    # The City touched it after filing: someone is working on it.
    if (
        created
        and modified
        and modified > created
        and (
            datetime.fromisoformat(modified) - datetime.fromisoformat(created) > timedelta(hours=1)
        )
    ):
        return "in_progress"
    return "filed_with_311"


def apply_city_status(report_id: str, city: dict) -> bool:
    """Move a linked Rapport report to the City's status (never backwards to 'submitted')."""
    table = get_table()
    meta = table.get_item(Key={"PK": f"REPORT#{report_id}", "SK": "META"}).get("Item")
    if not meta:
        return False
    new = city_status(city)
    if meta.get("status") == new or meta.get("status") == "closed_duplicate":
        return False
    now = _iso(_now())
    from app.services.reports import _event_sk  # avoid a cycle at import time

    note = {
        "resolved": f"NOLA 311 closed request #{city['id']}",
        "in_progress": f"NOLA 311 is working on request #{city['id']}",
        "filed_with_311": f"NOLA 311 request #{city['id']} is open",
    }[new]
    table.meta.client.transact_write_items(
        TransactItems=[
            {
                "Update": {
                    "TableName": table.name,
                    "Key": {"PK": f"REPORT#{report_id}", "SK": "META"},
                    "UpdateExpression": "SET #s = :s, updated_at = :now",
                    "ExpressionAttributeNames": {"#s": "status"},
                    "ExpressionAttributeValues": {":s": new, ":now": now},
                }
            },
            {
                "Put": {
                    "TableName": table.name,
                    "Item": {
                        "PK": f"REPORT#{report_id}",
                        "SK": _event_sk(now),
                        "status": new,
                        "event_source": "nola311",
                        "note": note,
                        "created_at": now,
                    },
                }
            },
        ]
    )
    return True


def linked_reports(ticket: str) -> list[str]:
    items = get_table().query(KeyConditionExpression=Key("PK").eq(f"TICKET#{ticket}"))["Items"]
    return [i["SK"].removeprefix("REPORT#") for i in items]


# --- Import ------------------------------------------------------------------------------


def import_rows(rows) -> dict:
    table = get_table()
    counts = {"upserted": 0, "skipped": 0, "synced": 0}
    latest = ""
    changed: list[dict] = []
    with table.batch_writer(overwrite_by_pkeys=["PK", "SK"]) as batch:
        for row in rows:
            item = nola311.to_item(row)
            if item is None:
                counts["skipped"] += 1
                continue
            batch.put_item(Item=item)
            counts["upserted"] += 1
            changed.append(item)
            latest = max(latest, item.get("modified_at") or "")
    for item in changed:
        for report_id in linked_reports(item["id"]):
            if apply_city_status(report_id, from_dynamo(item)):
                counts["synced"] += 1
    counts["latest_modified"] = latest
    return counts


def run(mode: str = "incremental", months: int = 24) -> dict:
    table = get_table()
    state = table.get_item(Key=STATE_KEY).get("Item") or {}
    if mode == "backfill" or not state.get("last_modified"):
        since = (_now() - timedelta(days=30 * months)).strftime("%Y-%m-%dT00:00:00")
        counts = import_rows(nola311.fetch_since("date_created", since))
        # Closed-then-reopened or old-but-modified requests arrive through the watermark.
    else:
        counts = import_rows(nola311.fetch_since("date_modified", state["last_modified"]))
    watermark = max(state.get("last_modified", ""), counts.pop("latest_modified", ""))
    counts["suggested"] = suggest_links()
    table.put_item(
        Item={
            **STATE_KEY,
            "last_modified": watermark,
            "last_run": _iso(_now()),
            "mode": mode,
            **counts,
        }
    )
    log.info("nola311 ingest mode=%s %s watermark=%s", mode, counts, watermark)
    return {**counts, "watermark": watermark}


# --- Suggested links ("is this your 311 request?") -----------------------------------------


def _recent_unlinked_reports() -> list[dict]:
    since = _iso(_now() - timedelta(days=SUGGEST_FOR_DAYS))
    items = get_table().query(
        IndexName="GSI3",
        KeyConditionExpression=Key("GSI3PK").eq("MAP") & Key("GSI3SK").gte(since),
    )["Items"]
    return [
        i
        for i in items
        if not i.get("nola311_ticket")
        and i.get("status") == "submitted"
        and not i.get("suggested_ticket")
        and not i.get("ticket_suggestion_dismissed")
    ]


def suggest_links() -> int:
    """Suggest a City request that looks like the resident's own filing of the same problem."""
    table = get_table()
    suggested = 0
    for report in _recent_unlinked_reports():
        loc = from_dynamo(report["location"])
        created = datetime.fromisoformat(report["created_at"])
        best = None
        for cell in geohash_neighborhood(loc["lat"], loc["lng"]):
            city_items = table.query(
                IndexName="GSI2",
                KeyConditionExpression=Key("GSI2PK").eq(f"GEO#{cell}")
                & Key("GSI2SK").begins_with(f"TYPE#{report['request_type']}#"),
            )["Items"]
            for city in city_items:
                if (
                    city.get("source") != "nola311"
                    or city["request_reason"] != report["request_reason"]
                ):
                    continue
                cloc = from_dynamo(city["location"])
                d = distance_m(loc["lat"], loc["lng"], cloc["lat"], cloc["lng"])
                # City timestamps are local time; the 72 h window absorbs the offset.
                city_created = datetime.fromisoformat(city["created_at"]).replace(tzinfo=UTC)
                if d > MATCH_RADIUS_M or abs(city_created - created) > MATCH_WINDOW:
                    continue
                p = get_jev().same_issue(
                    {
                        "reason": report["request_reason"],
                        "description": plain_text(report.get("description_html") or ""),
                        "reported": report["created_at"][:10],
                    },
                    {
                        "reason": city["request_reason"],
                        "address": city.get("address"),
                        "distance_m": round(d, 1),
                        "reported": city["created_at"][:10],
                    },
                )
                if p >= MATCH_THRESHOLD and (best is None or p > best[0]):
                    best = (p, city["id"])
        if best:
            table.update_item(
                Key={"PK": report["PK"], "SK": "META"},
                UpdateExpression="SET suggested_ticket = :t",
                ExpressionAttributeValues={
                    ":t": {"ticket": best[1], "probability": str(round(best[0], 3))}
                },
            )
            suggested += 1
    return suggested
