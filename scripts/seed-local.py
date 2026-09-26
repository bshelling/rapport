"""Load the NoSQL Workbench sample data into the local (MiniStack) table.

Usage: uv run --with boto3 scripts/seed-local.py
"""

import json
import os
from pathlib import Path

import boto3

MODEL = Path(__file__).resolve().parents[1] / "docs/dynamodb/rapport.workbench.json"

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")

table = json.loads(MODEL.read_text())["DataModel"][0]
client = boto3.client("dynamodb", region_name="us-east-1")
items = table["TableData"]
for i in range(0, len(items), 25):
    client.batch_write_item(
        RequestItems={table["TableName"]: [{"PutRequest": {"Item": it}} for it in items[i : i + 25]]}
    )
print(f"seeded {len(items)} items into {table['TableName']}")
