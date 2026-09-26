"""Lambda entry point for the scheduled NOLA 311 import.

Event: {} (incremental, nightly) or {"mode": "backfill", "months": 24}.
"""

import logging

from app.services import ingest

logging.getLogger().setLevel(logging.INFO)


def handler(event, context):
    event = event or {}
    return ingest.run(event.get("mode", "incremental"), int(event.get("months", 24)))
