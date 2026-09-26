"""Create (or reset) a report owned by a fake "neighbor" for Playwright's +1 tests.

It sits where the tests mock the browser's GPS, so the duplicate check finds it.
Prints the report id. Removed again by scripts/cleanup-e2e.py.

Usage: uv run --with boto3 scripts/seed-e2e.py <env>     (prod, local)
"""

import os
import sys
from datetime import UTC, datetime
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from app.geo import geohash  # noqa: E402

REPORT_ID = "e2e-neighbor-pothole"
NEIGHBOR = "e2e-neighbor"
LAT, LNG = 29.9277, -90.0741  # matches the geolocation mocked in web/e2e


def table_for(env: str):
    if env == "local":
        session = boto3.Session(
            aws_access_key_id="test",
            aws_secret_access_key="test",  # noqa: S106 (MiniStack dummy credentials)
            region_name="us-east-1",
        )
        return session.resource("dynamodb", endpoint_url="http://localhost:4566").Table(
            "rapport-local"
        )
    return boto3.resource("dynamodb", region_name="us-east-1").Table(f"rapport-{env}")


def main(env: str) -> None:
    table = table_for(env)
    # Reset: drop earlier +1s and events for this report.
    old = table.query(KeyConditionExpression=Key("PK").eq(f"REPORT#{REPORT_ID}"))["Items"]
    with table.batch_writer() as batch:
        for item in old:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    now = datetime.now(UTC).isoformat(timespec="seconds")
    table.put_item(
        Item={
            "PK": f"REPORT#{REPORT_ID}",
            "SK": "META",
            "GSI1PK": f"USER#{NEIGHBOR}",
            "GSI1SK": now,
            "GSI2PK": f"GEO#{geohash(LAT, LNG, 6)}",
            "GSI2SK": f"TYPE#Roads and Streets#{now}",
            "GSI3PK": "MAP",
            "GSI3SK": now,
            "id": REPORT_ID,
            "source": "rapport",
            "user_sub": NEIGHBOR,
            "request_type": "Roads and Streets",
            "request_reason": "Pothole",
            "contact": {"first_name": "Test", "last_name": "Neighbor", "email": "n@example.com"},
            "location": {"lat": Decimal(str(LAT)), "lng": Decimal(str(LNG)), "source": "gps"},
            "description_html": "<p>Deep pothole in the right lane (test data).</p>",
            "photo_keys": [],
            "photo_public": False,
            "status": "submitted",
            "supporter_count": 0,
            "created_at": now,
            "updated_at": now,
        }
    )
    print(REPORT_ID)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "prod")
