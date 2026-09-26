import base64
import json
from datetime import UTC, datetime
from decimal import Decimal

from boto3.dynamodb.conditions import Attr, Key
from ulid import ULID

from app import storage
from app.config import get_settings
from app.db import from_dynamo, get_table
from app.geo import geohash
from app.models.report import (
    OPEN_STATUSES,
    Report,
    ReportAI,
    ReportDetail,
    ReportEvent,
    ReportPage,
    ReportPhoto,
    ReportSummary,
)
from app.services import drafts


def _dec(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(round(value, 4)))


def _event_sk(now: str) -> str:
    # Timestamps are second-precision; the ULID keeps same-second events
    # distinct while preserving chronological order.
    return f"EVENT#{now}#{ULID()}"


class ReportNotFound(Exception):
    pass


class DraftIncomplete(Exception):
    def __init__(self, missing: list[str]):
        super().__init__(", ".join(missing))
        self.missing = missing


def submit_draft(draft_id: str, user_sub: str) -> Report:
    draft = drafts.get(draft_id, user_sub, with_urls=False)
    missing = draft.missing_fields()
    # Photos are optional, but every reserved slot must have been uploaded.
    if any(not storage.exists(p.key) for p in draft.photos):
        missing.append("photos")
    if missing:
        raise DraftIncomplete(missing)

    report_id = str(ULID())
    now = datetime.now(UTC).isoformat(timespec="seconds")
    photo_keys = []
    for photo in draft.photos:
        key = f"reports/{report_id}/{photo.id}.jpg"
        storage.move(photo.key, key)
        photo_keys.append(key)

    loc = draft.location
    assert loc is not None and draft.contact is not None  # guaranteed by missing_fields
    item = {
        "PK": f"REPORT#{report_id}",
        "SK": "META",
        "GSI1PK": f"USER#{user_sub}",
        "GSI1SK": now,
        "GSI2PK": f"GEO#{geohash(loc.lat, loc.lng, 6)}",
        "GSI2SK": f"TYPE#{draft.request_type}#{now}",
        "GSI3PK": "MAP",
        "GSI3SK": now,
        "id": report_id,
        "source": "rapport",
        "user_sub": user_sub,
        "request_type": draft.request_type,
        "request_reason": draft.request_reason,
        "contact": draft.contact.model_dump(),
        "location": {
            **loc.model_dump(),
            "lat": Decimal(str(loc.lat)),
            "lng": Decimal(str(loc.lng)),
        },
        "geohash": geohash(loc.lat, loc.lng, 9),
        "description_html": draft.description_html,
        "photo_keys": photo_keys,
        # Photos are shown to others only when AI triage ran and saw no people/plates.
        "photo_public": bool(photo_keys)
        and draft.triage is not None
        and draft.triage.status == "done"
        and not draft.photos_private,
        "status": "submitted",
        "supporter_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    if draft.triage and draft.triage.status == "done":
        t = draft.triage
        item["ai"] = {
            "suggested_reason": t.suggested.request_reason if t.suggested else None,
            "reason_confidence": _dec(t.reason_confidence),
            "severity_level": t.severity.level if t.severity else None,
            "severity_label": t.severity.label if t.severity else None,
            "safety_hazard": _dec(t.safety_hazard),
            "matches_selection": _dec(t.matches_selection),
            "scene_description": t.observation.scene_description if t.observation else None,
        }
    event = {
        "PK": f"REPORT#{report_id}",
        "SK": _event_sk(now),
        "status": "submitted",
        "event_source": "user",
        "created_at": now,
    }
    client = get_table().meta.client
    table = get_table().name
    client.transact_write_items(
        TransactItems=[
            {"Put": {"TableName": table, "Item": item}},
            {"Put": {"TableName": table, "Item": event}},
            {
                "Delete": {
                    "TableName": table,
                    "Key": {"PK": f"DRAFT#{draft_id}", "SK": "META"},
                    "ConditionExpression": "user_sub = :u",
                    "ExpressionAttributeValues": {":u": user_sub},
                }
            },
        ]
    )
    return Report(
        id=report_id,
        request_type=item["request_type"],
        request_reason=item["request_reason"],
        contact=draft.contact,
        location=loc,
        description_html=item["description_html"],
        photo_keys=photo_keys,
        status="submitted",
        created_at=now,
        updated_at=now,
    )


# --- Reading ----------------------------------------------------------------

StatusFilter = str  # "all" | "open" | "resolved"


def _encode_cursor(key: dict | None) -> str | None:
    if not key:
        return None
    return base64.urlsafe_b64encode(json.dumps(key).encode()).decode()


def _decode_cursor(cursor: str | None) -> dict | None:
    if not cursor:
        return None
    try:
        key = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except (ValueError, json.JSONDecodeError):
        return None
    return key if isinstance(key, dict) else None


def _summary(item: dict) -> ReportSummary:
    photos = item.get("photo_keys", [])
    loc = item["location"]
    return ReportSummary(
        id=item["id"],
        request_type=item["request_type"],
        request_reason=item["request_reason"],
        status=item["status"],
        address=loc.get("address"),
        lat=float(loc["lat"]),
        lng=float(loc["lng"]),
        supporter_count=int(item.get("supporter_count", 0)),
        photo_count=len(photos),
        thumbnail_url=storage.presign_get(photos[0]) if photos else None,
        nola311_ticket=item.get("nola311_ticket"),
        created_at=item["created_at"],
        updated_at=item["updated_at"],
    )


def list_mine(
    user_sub: str, status: StatusFilter = "all", limit: int = 20, cursor: str | None = None
) -> ReportPage:
    kwargs: dict = {
        "IndexName": "GSI1",
        "KeyConditionExpression": Key("GSI1PK").eq(f"USER#{user_sub}"),
        "ScanIndexForward": False,  # newest first
        "Limit": limit,
    }
    if status == "open":
        kwargs["FilterExpression"] = Attr("status").is_in(list(OPEN_STATUSES))
    elif status == "resolved":
        kwargs["FilterExpression"] = Attr("status").eq("resolved")
    if start := _decode_cursor(cursor):
        kwargs["ExclusiveStartKey"] = start
    res = get_table().query(**kwargs)
    return ReportPage(
        reports=[_summary(i) for i in res["Items"]],
        next_cursor=_encode_cursor(res.get("LastEvaluatedKey")),
    )


def _items(report_id: str) -> tuple[dict, list[dict]]:
    items = get_table().query(KeyConditionExpression=Key("PK").eq(f"REPORT#{report_id}"))["Items"]
    meta = next((i for i in items if i["SK"] == "META"), None)
    if meta is None:
        raise ReportNotFound(report_id)
    events = sorted((i for i in items if i["SK"].startswith("EVENT#")), key=lambda e: e["SK"])
    return meta, events


def _ai(ai: dict | None) -> ReportAI | None:
    if not ai:
        return None
    return ReportAI(
        **{k: (float(v) if isinstance(v, Decimal) else v) for k, v in ai.items() if v is not None}
    )


def get_detail(report_id: str, viewer_sub: str) -> ReportDetail:
    meta, events = _items(report_id)
    is_owner = meta.get("user_sub") == viewer_sub
    loc = meta["location"]
    return ReportDetail(
        id=meta["id"],
        is_owner=is_owner,
        request_type=meta["request_type"],
        request_reason=meta["request_reason"],
        status=meta["status"],
        location={**loc, "lat": float(loc["lat"]), "lng": float(loc["lng"])},
        description_html=meta["description_html"],
        # Others only see photos that AI triage screened (no people or plates).
        photos=[ReportPhoto(key=k, url=storage.presign_get(k)) for k in meta.get("photo_keys", [])]
        if is_owner or meta.get("photo_public")
        else [],
        photo_public=bool(meta.get("photo_public", False)),
        supported_by_me=False if is_owner else supported_by(report_id, viewer_sub),
        ai=_ai(meta.get("ai")),
        supporter_count=int(meta.get("supporter_count", 0)),
        nola311_ticket=meta.get("nola311_ticket"),
        nola311_verified=bool(meta.get("nola311_verified", False)),
        suggested_ticket=from_dynamo(meta.get("suggested_ticket")) if is_owner else None,
        contact=meta.get("contact") if is_owner else None,
        events=[
            ReportEvent(
                status=e["status"],
                source=e.get("event_source", "system"),
                note=e.get("note"),
                created_at=e["created_at"],
            )
            for e in events
        ],
        created_at=meta["created_at"],
        updated_at=meta["updated_at"],
    )


def set_ticket(report_id: str, user_sub: str, ticket: str) -> ReportDetail:
    """Record the NOLA 311 request number; the first time, mark it filed.

    The number is checked against the City's open data. A match syncs the status right
    away; no match is still accepted (the dataset refreshes daily) and marked unverified.
    """
    from app.services import ingest, nola311  # avoid import cycles

    meta, _ = _items(report_id)
    if meta.get("user_sub") != user_sub:
        raise ReportNotFound(report_id)
    city = None
    if get_settings().nola311_mode == "live":
        try:
            city = nola311.fetch_ticket(ticket)
        except Exception:  # City API down: accept, verify tonight
            city = None
    now = datetime.now(UTC).isoformat(timespec="seconds")
    new_status = "filed_with_311" if meta["status"] == "submitted" else meta["status"]
    table = get_table()
    items: list[dict] = [
        {
            "Update": {
                "TableName": table.name,
                "Key": {"PK": f"REPORT#{report_id}", "SK": "META"},
                "UpdateExpression": "SET nola311_ticket = :t, nola311_verified = :v, #s = :s, "
                "updated_at = :now REMOVE suggested_ticket",
                "ConditionExpression": "user_sub = :u",
                "ExpressionAttributeNames": {"#s": "status"},
                "ExpressionAttributeValues": {
                    ":t": ticket,
                    ":v": city is not None,
                    ":s": new_status,
                    ":now": now,
                    ":u": user_sub,
                },
            }
        },
        # Pointer so the nightly import can find reports by ticket.
        {
            "Put": {
                "TableName": table.name,
                "Item": {"PK": f"TICKET#{ticket}", "SK": f"REPORT#{report_id}"},
            }
        },
    ]
    previous = meta.get("nola311_ticket")
    if previous and previous != ticket:
        items.append(
            {
                "Delete": {
                    "TableName": table.name,
                    "Key": {"PK": f"TICKET#{previous}", "SK": f"REPORT#{report_id}"},
                }
            }
        )
    if previous != ticket:
        items.append(
            {
                "Put": {
                    "TableName": table.name,
                    "Item": {
                        "PK": f"REPORT#{report_id}",
                        "SK": _event_sk(now),
                        "status": new_status,
                        "event_source": "user",
                        "note": f"Filed with NOLA 311 as {ticket}",
                        "created_at": now,
                    },
                }
            }
        )
    table.meta.client.transact_write_items(TransactItems=items)
    if city is not None:
        item = nola311.to_item(city)
        if item:
            ingest.apply_city_status(report_id, from_dynamo(item))
    return get_detail(report_id, user_sub)


def dismiss_ticket_suggestion(report_id: str, user_sub: str) -> ReportDetail:
    meta, _ = _items(report_id)
    if meta.get("user_sub") != user_sub:
        raise ReportNotFound(report_id)
    get_table().update_item(
        Key={"PK": f"REPORT#{report_id}", "SK": "META"},
        UpdateExpression="SET ticket_suggestion_dismissed = :t REMOVE suggested_ticket",
        ExpressionAttributeValues={":t": True},
    )
    return get_detail(report_id, user_sub)


# --- Supporters ("+1") --------------------------------------------------------------


class CannotSupport(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def support(report_id: str, user_sub: str, draft_id: str | None = None) -> int:
    """Add the user's +1 (once), optionally with their draft's photo; returns the new count."""
    meta, _ = _items(report_id)
    if meta.get("user_sub") == user_sub:
        raise CannotSupport("You reported this one.")
    if meta.get("status") not in OPEN_STATUSES:
        raise CannotSupport("This report is closed.")

    photo_key = source_key = None
    photo_public = False
    draft = None
    if draft_id:
        draft = drafts.get(draft_id, user_sub, with_urls=False)  # raises DraftNotFound
        uploaded = [p for p in draft.photos if storage.exists(p.key)]
        if uploaded:
            source_key = uploaded[0].key
            photo_key = f"reports/{report_id}/support/{uploaded[0].id}.jpg"
            photo_public = (
                draft.triage is not None
                and draft.triage.status == "done"
                and not draft.photos_private
            )

    now = datetime.now(UTC).isoformat(timespec="seconds")
    table = get_table()
    support_item = {
        "PK": f"REPORT#{report_id}",
        "SK": f"SUPPORT#{user_sub}",
        "user_sub": user_sub,
        "created_at": now,
        "photo_public": photo_public,
    }
    if photo_key:
        support_item["photo_key"] = photo_key
    items: list[dict] = [
        {
            "Put": {
                "TableName": table.name,
                "Item": support_item,
                "ConditionExpression": "attribute_not_exists(PK)",
            }
        },
        {
            "Update": {
                "TableName": table.name,
                "Key": {"PK": f"REPORT#{report_id}", "SK": "META"},
                "UpdateExpression": "ADD supporter_count :one SET updated_at = :now",
                "ExpressionAttributeValues": {":one": 1, ":now": now},
            }
        },
    ]
    if draft_id:
        items.append(
            {
                "Delete": {
                    "TableName": table.name,
                    "Key": {"PK": f"DRAFT#{draft_id}", "SK": "META"},
                    "ConditionExpression": "user_sub = :u",
                    "ExpressionAttributeValues": {":u": user_sub},
                }
            }
        )
    try:
        table.meta.client.transact_write_items(TransactItems=items)
    except table.meta.client.exceptions.TransactionCanceledException as exc:
        codes = [r.get("Code") for r in exc.response.get("CancellationReasons", [])]
        if codes and codes[0] == "ConditionalCheckFailed":
            raise CannotSupport("You already added your +1.") from exc
        raise
    if source_key and photo_key:
        storage.move(source_key, photo_key)
    return int(meta.get("supporter_count", 0)) + 1


def supported_by(report_id: str, user_sub: str) -> bool:
    item = get_table().get_item(Key={"PK": f"REPORT#{report_id}", "SK": f"SUPPORT#{user_sub}"})
    return "Item" in item
