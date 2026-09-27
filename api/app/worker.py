"""Background worker: AI work for drafts and chat turns. Invoked asynchronously by the API."""

import logging

from app.services import agent_client, duplicates, triage

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger(__name__)

TASKS = {
    "triage": triage.run,
    "reclassify": triage.reclassify,
    "duplicates": duplicates.run,
    "agent_turn": agent_client.run_turn,
}


def handle(task: str, item_id: str) -> None:
    fn = TASKS.get(task)
    if fn is None:
        log.warning("unknown task %s", task)
        return
    result = fn(item_id)
    status = result if isinstance(result, str) else getattr(result, "status", None)
    log.info("task=%s id=%s status=%s", task, item_id, status)


def handler(event, context):  # AWS Lambda entry point
    # "draft_id" is the payload key used before chat turns shared the worker.
    handle(event["task"], event.get("id") or event["draft_id"])
    return {"ok": True}
