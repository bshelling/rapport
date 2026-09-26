"""Photo triage: Claude describes the photo, Jev classifies it, results land on the draft.

Runs in the worker Lambda (or in-process locally). Every step is best-effort:
a failure records an error on the draft and never blocks submitting.
"""

import logging
from datetime import UTC, datetime

from app import storage
from app.db import from_dynamo, get_table, to_dynamo
from app.html import plain_text
from app.models.insights import Observation, Triage
from app.services.jev import get_jev
from app.services.vision import get_vision

log = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _key(draft_id: str) -> dict:
    return {"PK": f"DRAFT#{draft_id}", "SK": "META"}


def _save(draft_id: str, triage: Triage, photos_private: bool | None = None) -> None:
    update = "SET triage = :t, updated_at = :now"
    values: dict = {
        ":t": to_dynamo(triage.model_dump(mode="json", exclude_none=True)),
        ":now": _now(),
    }
    if photos_private is not None:
        update += ", photos_private = :p"
        values[":p"] = photos_private
    get_table().update_item(
        Key=_key(draft_id),
        UpdateExpression=update,
        ExpressionAttributeValues=values,
        ConditionExpression="attribute_exists(PK)",  # draft may have been submitted
    )


def _classify(draft: dict, obs: Observation, photo_id: str) -> Triage:
    result = get_jev().classify(
        obs, draft.get("request_reason"), plain_text(draft.get("description_html") or "") or None
    )
    return Triage(
        status="done",
        photo_id=photo_id,
        observation=obs,
        suggested=result.suggested,
        alternatives=result.alternatives,
        reason_confidence=result.reason_confidence,
        severity=result.severity,
        is_actionable=result.is_actionable,
        safety_hazard=result.safety_hazard,
        matches_selection=result.matches_selection,
        updated_at=_now(),
    )


def run(draft_id: str) -> Triage | None:
    """Triage the draft's first photo (vision + Jev)."""
    draft = get_table().get_item(Key=_key(draft_id)).get("Item")
    if not draft or not draft.get("photos"):
        return None
    photo = draft["photos"][0]
    existing = draft.get("triage")
    if existing and existing.get("photo_id") == photo["id"] and existing.get("status") == "done":
        return Triage.model_validate(from_dynamo(existing))  # already done for this photo

    _save(draft_id, Triage(status="pending", photo_id=photo["id"], updated_at=_now()))
    try:
        obs = get_vision().observe(storage.read(photo["key"]))
        triage = _classify(draft, obs, photo["id"])
        _save(draft_id, triage, photos_private=obs.contains_person_or_plate)
        return triage
    except Exception as exc:  # recorded on the draft; submission still works
        log.exception("triage failed for draft %s", draft_id)
        failed = Triage(
            status="error", photo_id=photo["id"], error=type(exc).__name__, updated_at=_now()
        )
        _save(draft_id, failed)
        return failed


def reclassify(draft_id: str) -> Triage | None:
    """Re-run only Jev (e.g. the resident changed the reason); reuses the observation."""
    draft = get_table().get_item(Key=_key(draft_id)).get("Item")
    existing = (draft or {}).get("triage")
    if not draft or not existing or existing.get("status") != "done":
        return None
    obs = Observation.model_validate(from_dynamo(existing["observation"]))
    try:
        triage = _classify(draft, obs, existing["photo_id"])
    except Exception:
        log.exception("reclassify failed for draft %s", draft_id)
        return None
    _save(draft_id, triage)
    return triage
