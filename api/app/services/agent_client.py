"""Talk to the Rapport chat agent (AgentCore Runtime in AWS, a local server in dev)."""

import json
import logging
import re
import time
import urllib.request
from datetime import UTC, datetime
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from ulid import ULID

from app.config import get_settings
from app.db import get_table
from app.services.jev import get_jev

log = logging.getLogger(__name__)

OFF_TOPIC_REPLY = (
    "I can help with street, sidewalk and drainage problems in New Orleans (potholes, "
    "clogged catch basins, flooding) and with the status of your reports. What's going on?"
)
ERROR_REPLY = "Sorry, I couldn't answer just now. Please try again, or use the report form."
ON_TOPIC_THRESHOLD = 0.2

# The app shows no emojis; the prompt asks for none and this catches any that slip through.
_EMOJI = re.compile("[\U0001f000-\U0001faff\u2600-\u27bf\u2b00-\u2bff\ufe0f\u200d\u20e3]+[ \t]?")


def strip_emojis(text: str) -> str:
    return _EMOJI.sub("", text).strip()


class LimitReached(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _count(key: str, limit: int, ttl_seconds: int) -> int:
    """Atomically increment a counter; raises LimitReached past `limit`."""
    try:
        res = get_table().update_item(
            Key={"PK": key, "SK": "COUNT"},
            UpdateExpression="ADD n :one SET expires_at = if_not_exists(expires_at, :exp)",
            ConditionExpression="attribute_not_exists(n) OR n < :limit",
            ExpressionAttributeValues={
                ":one": 1,
                ":limit": limit,
                ":exp": int(time.time()) + ttl_seconds,
            },
            ReturnValues="UPDATED_NEW",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise LimitReached(key) from exc
        raise
    return int(res["Attributes"]["n"])


@lru_cache
def _agentcore():
    # Runs in the worker (90 s), so a slow turn or a cold runtime has room to finish.
    # One attempt only: a retry would run the turn twice on the same session and the
    # resident would get the second, draft-less answer (and a second bill).
    return boto3.client(
        "bedrock-agentcore",
        region_name=get_settings().aws_region,
        config=Config(
            read_timeout=80,
            connect_timeout=5,
            retries={"mode": "standard", "total_max_attempts": 1},
        ),
    )


def _invoke(payload: dict) -> dict:
    settings = get_settings()
    if settings.agent_mode == "fake":
        return {
            "reply": f"(fake agent) You said: {payload['message']}",
            "draft_id": None,
            "actions": [],
        }
    body = json.dumps(payload).encode()
    if settings.agent_mode == "http":
        req = urllib.request.Request(  # noqa: S310 (local dev URL from settings)
            f"{settings.agent_url}/invocations",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=85) as res:  # noqa: S310
            return json.loads(res.read())
    # AgentCore needs session ids of 33+ characters; one runtime session per chat.
    session = f"{payload['user_sub']}:{payload['session_id']}".ljust(33, "0")
    res = _agentcore().invoke_agent_runtime(
        agentRuntimeArn=settings.agent_runtime_arn,
        runtimeSessionId=session,
        payload=body,
        contentType="application/json",
        accept="application/json",
    )
    return json.loads(res["response"].read())


def _off_topic(message: str) -> bool:
    try:
        return get_jev().on_topic(message) < ON_TOPIC_THRESHOLD
    except Exception:  # noqa: BLE001 - the agent redirects off-topic chats itself too
        log.warning("on-topic check failed", exc_info=True)
        return False


class TurnNotFound(Exception):
    pass


def _turn_key(turn_id: str) -> dict:
    return {"PK": f"TURN#{turn_id}", "SK": "META"}


def _turn_out(turn_id: str, item: dict) -> dict:
    return {
        "turn_id": turn_id,
        "status": item["status"],
        "reply": item.get("reply"),
        "draft_id": item.get("draft_id"),
        "actions": item.get("actions", []),
        "off_topic": bool(item.get("off_topic")),
    }


def start_turn(user_sub: str, session_id: str, message: str) -> dict:
    """Check limits and topic, then queue the turn for the worker; returns at once."""
    settings = get_settings()
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    try:
        turn = _count(f"RATE#agent#{user_sub}#{session_id}", settings.agent_max_per_session, 86400)
        _count(f"RATE#agentday#{user_sub}#{day}", settings.agent_max_per_day, 2 * 86400)
    except LimitReached as exc:
        per_session = "#agent#" in exc.message
        raise LimitReached(
            "This chat is getting long. Start a new chat to keep going."
            if per_session
            else "You've reached today's chat limit. The report form works any time."
        ) from None
    turn_id = str(ULID())
    now = datetime.now(UTC).isoformat(timespec="seconds")
    item = {
        **_turn_key(turn_id),
        "user_sub": user_sub,
        "session_id": session_id,
        "message": message,
        "status": "pending",
        "created_at": now,
        "expires_at": int(time.time()) + 86400,
    }
    # Only the opening message needs a topic check; follow-ups ("yes", "Magazine and
    # Napoleon") only make sense in context, and the agent steers conversations itself.
    if turn == 1 and _off_topic(message):
        item.update(status="done", reply=OFF_TOPIC_REPLY, actions=[], off_topic=True)
    get_table().put_item(Item=item)
    return _turn_out(turn_id, item)


def run_turn(turn_id: str) -> str:
    """Worker task: run a queued turn through the agent and store the answer."""
    table = get_table()
    item = table.get_item(Key=_turn_key(turn_id)).get("Item")
    if not item or item["status"] != "pending":
        return "skipped"
    try:
        out = _invoke(
            {
                "user_sub": item["user_sub"],
                "session_id": item["session_id"],
                "message": item["message"],
            }
        )
        result = {
            "status": "done",
            "reply": strip_emojis(out.get("reply", "")),
            "draft_id": out.get("draft_id"),
            "actions": out.get("actions", []),
        }
    except Exception:  # noqa: BLE001 - the resident gets a retry prompt instead of silence
        log.exception("agent turn %s failed", turn_id)
        result = {"status": "error", "reply": ERROR_REPLY, "actions": []}
    table.update_item(
        Key=_turn_key(turn_id),
        UpdateExpression="SET #s = :s, reply = :r, draft_id = :d, actions = :a",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":s": result["status"],
            ":r": result["reply"],
            ":d": result.get("draft_id"),
            ":a": result["actions"],
        },
    )
    return result["status"]


def get_turn(turn_id: str, user_sub: str) -> dict:
    item = get_table().get_item(Key=_turn_key(turn_id)).get("Item")
    if not item or item.get("user_sub") != user_sub:
        raise TurnNotFound(turn_id)
    return _turn_out(turn_id, item)
