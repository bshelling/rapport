"""Background worker: AI processing for drafts. Invoked asynchronously by the API."""

import logging

from app.services import duplicates, triage

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger(__name__)

TASKS = {
    "triage": triage.run,
    "reclassify": triage.reclassify,
    "duplicates": duplicates.run,
}


def handle(task: str, draft_id: str) -> None:
    fn = TASKS.get(task)
    if fn is None:
        log.warning("unknown task %s", task)
        return
    result = fn(draft_id)
    log.info("task=%s draft=%s status=%s", task, draft_id, getattr(result, "status", None))


def handler(event, context):  # AWS Lambda entry point
    handle(event["task"], event["draft_id"])
    return {"ok": True}
