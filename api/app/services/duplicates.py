"""Duplicate detection: is someone's report of this same problem already open nearby?

Cheap geometric filtering first (geohash cells, same type, open, recent, <= 75 m),
then Jev decides "same physical issue?" for the closest few.
"""

import logging
from datetime import UTC, datetime, timedelta

from boto3.dynamodb.conditions import Key

from app.db import from_dynamo, get_table, to_dynamo
from app.geo import distance_m, geohash_neighborhood
from app.html import plain_text
from app.models.insights import DuplicateCandidate, DuplicateCheck
from app.models.report import OPEN_STATUSES
from app.services.jev import get_jev

log = logging.getLogger(__name__)

RADIUS_M = 75
MAX_AGE_DAYS = 90
MAX_CHECKED = 5
THRESHOLD = 0.7


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def check_key(request_type: str, lat: float, lng: float) -> str:
    return f"{request_type}|{lat:.5f}|{lng:.5f}"


def nearby(
    request_type: str, lat: float, lng: float, exclude_ids: set[str] | None = None
) -> list[tuple[float, dict]]:
    """Open, recent reports of the same type within RADIUS_M, closest first."""
    table = get_table()
    since = (datetime.now(UTC) - timedelta(days=MAX_AGE_DAYS)).isoformat(timespec="seconds")
    found: list[tuple[float, dict]] = []
    for cell in geohash_neighborhood(lat, lng):
        res = table.query(
            IndexName="GSI2",
            KeyConditionExpression=Key("GSI2PK").eq(f"GEO#{cell}")
            & Key("GSI2SK").between(f"TYPE#{request_type}#{since}", f"TYPE#{request_type}#~"),
        )
        for item in res["Items"]:
            if item.get("id") in (exclude_ids or set()):
                continue
            if item.get("status", item.get("request_status")) not in (*OPEN_STATUSES, "Pending"):
                continue
            loc = item.get("location") or {"lat": item.get("lat"), "lng": item.get("lng")}
            d = distance_m(lat, lng, float(loc["lat"]), float(loc["lng"]))
            if d <= RADIUS_M:
                found.append((d, item))
    found.sort(key=lambda pair: pair[0])
    return found


def _candidate(item: dict, dist: float, user_sub: str, probability: float) -> DuplicateCandidate:
    source = item.get("source", "rapport")
    return DuplicateCandidate(
        report_id=item["id"],
        source=source,
        request_reason=item["request_reason"],
        status=item.get("status", "submitted"),
        distance_m=round(dist, 1),
        supporter_count=int(item.get("supporter_count", 0)),
        nola311_ticket=item.get("nola311_ticket"),
        created_at=item["created_at"],
        is_mine=item.get("user_sub") == user_sub,
        probability=round(probability, 3),
    )


def run(draft_id: str) -> DuplicateCheck | None:
    table = get_table()
    draft = table.get_item(Key={"PK": f"DRAFT#{draft_id}", "SK": "META"}).get("Item")
    if not draft or not draft.get("location") or not draft.get("request_type"):
        return None
    loc = from_dynamo(draft["location"])
    key = check_key(draft["request_type"], loc["lat"], loc["lng"])
    existing = draft.get("duplicates")
    if existing and existing.get("checked_for") == key and existing.get("status") == "done":
        return DuplicateCheck.model_validate(from_dynamo(existing))

    triage = from_dynamo(draft.get("triage")) or {}
    new = {
        "reason": draft.get("request_reason"),
        "description": plain_text(draft.get("description_html") or "") or None,
        "photo": (triage.get("observation") or {}).get("scene_description"),
    }
    try:
        matches = []
        for dist, item in nearby(draft["request_type"], loc["lat"], loc["lng"])[:MAX_CHECKED]:
            existing_report = {
                "reason": item["request_reason"],
                "description": plain_text(item.get("description_html") or "") or None,
                "distance_m": round(dist, 1),
                "reported": item["created_at"][:10],
            }
            p = get_jev().same_issue(new, existing_report)
            if p >= THRESHOLD:
                matches.append(_candidate(item, dist, draft["user_sub"], p))
        result = DuplicateCheck(status="done", checked_for=key, matches=matches, updated_at=_now())
    except Exception:
        log.exception("duplicate check failed for draft %s", draft_id)
        result = DuplicateCheck(status="error", checked_for=key, updated_at=_now())
    table.update_item(
        Key={"PK": f"DRAFT#{draft_id}", "SK": "META"},
        UpdateExpression="SET duplicates = :d",
        ExpressionAttributeValues={":d": to_dynamo(result.model_dump(mode="json"))},
        ConditionExpression="attribute_exists(PK)",
    )
    return result
