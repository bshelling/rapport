from datetime import UTC, datetime
from decimal import Decimal

from ulid import ULID

from app import storage
from app.db import get_table
from app.geo import geohash
from app.models.report import Report
from app.services import drafts


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
        "status": "submitted",
        "supporter_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    event = {
        "PK": f"REPORT#{report_id}",
        "SK": f"EVENT#{now}",
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
