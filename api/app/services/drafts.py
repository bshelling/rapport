import time
from datetime import UTC, datetime
from decimal import Decimal

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from ulid import ULID

from app import storage
from app.db import get_table
from app.models.draft import MAX_PHOTOS, Draft, DraftPatch, Photo

DRAFT_TTL_SECONDS = 7 * 24 * 3600


class DraftNotFound(Exception):
    pass


class TooManyPhotos(Exception):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _key(draft_id: str) -> dict:
    return {"PK": f"DRAFT#{draft_id}", "SK": "META"}


def _to_model(item: dict) -> Draft:
    return Draft(
        id=item["id"],
        step=int(item.get("step", 1)),
        request_type=item.get("request_type"),
        request_reason=item.get("request_reason"),
        contact=item.get("contact"),
        location=_floats(item.get("location")),
        description_html=item.get("description_html"),
        photos=[Photo(**p) for p in item.get("photos", [])],
        created_at=item["created_at"],
        updated_at=item["updated_at"],
    )


def _floats(location: dict | None) -> dict | None:
    # DynamoDB returns Decimals; the API speaks floats.
    if not location:
        return None
    return {**location, "lat": float(location["lat"]), "lng": float(location["lng"])}


def _decimals(location: dict) -> dict:
    return {**location, "lat": Decimal(str(location["lat"])), "lng": Decimal(str(location["lng"]))}


def create(user_sub: str) -> Draft:
    now = _now()
    draft_id = str(ULID())
    item = {
        **_key(draft_id),
        "id": draft_id,
        "user_sub": user_sub,
        "step": 1,
        "photos": [],
        "created_at": now,
        "updated_at": now,
        "expires_at": int(time.time()) + DRAFT_TTL_SECONDS,
    }
    get_table().put_item(Item=item)
    return _to_model(item)


def _get_item(draft_id: str, user_sub: str) -> dict:
    item = get_table().get_item(Key=_key(draft_id)).get("Item")
    # Other users' drafts are indistinguishable from missing ones.
    if not item or item.get("user_sub") != user_sub:
        raise DraftNotFound(draft_id)
    return item


def get(draft_id: str, user_sub: str, with_urls: bool = True) -> Draft:
    draft = _to_model(_get_item(draft_id, user_sub))
    if with_urls:
        for photo in draft.photos:
            photo.url = storage.presign_get(photo.key)
    return draft


def update(draft_id: str, user_sub: str, patch: DraftPatch) -> Draft:
    item = _get_item(draft_id, user_sub)
    values = patch.model_dump(exclude_unset=True)
    # Changing the type clears a reason that no longer applies.
    type_changed = values.get("request_type", item.get("request_type")) != item.get("request_type")
    if type_changed and "request_reason" not in values:
        values["request_reason"] = None
    if values.get("location"):
        values["location"] = _decimals(values["location"])
    for key, value in values.items():
        if value is None:
            item.pop(key, None)
        else:
            item[key] = value
    item["updated_at"] = _now()
    item["expires_at"] = int(time.time()) + DRAFT_TTL_SECONDS
    get_table().put_item(Item=item, ConditionExpression=Attr("user_sub").eq(user_sub))
    return get(draft_id, user_sub)


def add_photo(draft_id: str, user_sub: str) -> tuple[Photo, dict]:
    item = _get_item(draft_id, user_sub)
    photos = item.get("photos", [])
    if len(photos) >= MAX_PHOTOS:
        raise TooManyPhotos()
    photo_id = str(ULID())
    photo = {"id": photo_id, "key": f"drafts/{draft_id}/{photo_id}.jpg"}
    try:
        get_table().update_item(
            Key=_key(draft_id),
            UpdateExpression="SET photos = list_append(photos, :p), updated_at = :now",
            ConditionExpression="user_sub = :u AND size(photos) < :max",
            ExpressionAttributeValues={
                ":p": [photo],
                ":now": _now(),
                ":u": user_sub,
                ":max": MAX_PHOTOS,
            },
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise TooManyPhotos() from exc
        raise
    return Photo(**photo), storage.presign_upload(photo["key"])


def remove_photo(draft_id: str, user_sub: str, photo_id: str) -> Draft:
    item = _get_item(draft_id, user_sub)
    photos = item.get("photos", [])
    kept = [p for p in photos if p["id"] != photo_id]
    if len(kept) == len(photos):
        raise DraftNotFound(photo_id)
    item["photos"] = kept
    item["updated_at"] = _now()
    get_table().put_item(Item=item)
    storage.delete(next(p["key"] for p in photos if p["id"] == photo_id))
    return get(draft_id, user_sub)
