import json
from functools import lru_cache

import boto3
from fastapi import BackgroundTasks

from app.config import get_settings


@lru_cache
def _lambda():
    return boto3.client("lambda", region_name=get_settings().aws_region)


def dispatch(task: str, item_id: str, background: BackgroundTasks) -> None:
    """Run AI work without blocking the request: async Lambda in AWS, in-process locally.

    `item_id` is the draft for draft tasks, the chat turn for `agent_turn`.
    """
    settings = get_settings()
    if settings.worker_mode == "lambda":
        _lambda().invoke(
            FunctionName=settings.worker_function,
            InvocationType="Event",
            Payload=json.dumps({"task": task, "id": item_id}).encode(),
        )
    else:
        from app.worker import handle

        background.add_task(handle, task, item_id)
