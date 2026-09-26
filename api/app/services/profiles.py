from datetime import UTC, datetime

from app.db import get_table
from app.models.profile import Profile, ProfileUpdate

_FIELDS = ("first_name", "last_name", "email", "phone", "phone_type", "neighborhood")


def _key(sub: str) -> dict:
    return {"PK": f"USER#{sub}", "SK": "PROFILE"}


def get_profile(sub: str, email: str | None = None) -> Profile:
    """Return the stored profile, or an unsaved default seeded from token claims."""
    item = get_table().get_item(Key=_key(sub)).get("Item")
    if not item:
        return Profile(sub=sub, email=email)
    return Profile(sub=sub, **{k: item.get(k) for k in (*_FIELDS, "created_at", "updated_at")})


def save_profile(sub: str, update: ProfileUpdate) -> Profile:
    now = datetime.now(UTC).isoformat(timespec="seconds")
    values = update.model_dump()
    set_parts = [f"#{k} = :{k}" for k in _FIELDS if values[k] is not None]
    remove_parts = [f"#{k}" for k in _FIELDS if values[k] is None]
    expr = "SET " + ", ".join(
        [*set_parts, "updated_at = :now", "created_at = if_not_exists(created_at, :now)"]
    )
    if remove_parts:
        expr += " REMOVE " + ", ".join(remove_parts)
    res = get_table().update_item(
        Key=_key(sub),
        UpdateExpression=expr,
        ExpressionAttributeNames={f"#{k}": k for k in _FIELDS},
        ExpressionAttributeValues={
            **{f":{k}": values[k] for k in _FIELDS if values[k] is not None},
            ":now": now,
        },
        ReturnValues="ALL_NEW",
    )
    item = res["Attributes"]
    return Profile(sub=sub, **{k: item.get(k) for k in (*_FIELDS, "created_at", "updated_at")})
