import boto3
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from app import auth, db, storage
from app.config import get_settings

TABLE = "rapport-test"
BUCKET = "rapport-photos-test"


def _reset_caches():
    # Tests may monkeypatch these with plain callables, so clear defensively.
    for fn in (get_settings, db.get_table, auth._jwks_client, storage._s3):
        if hasattr(fn, "cache_clear"):
            fn.cache_clear()


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for k in ("AWS_ENDPOINT_URL", "AWS_PROFILE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("RAPPORT_ENVIRONMENT", "test")
    monkeypatch.setenv("RAPPORT_AUTH_MODE", "dev")
    monkeypatch.setenv("RAPPORT_TABLE_NAME", TABLE)
    monkeypatch.setenv("RAPPORT_PHOTO_BUCKET", BUCKET)
    _reset_caches()
    yield
    _reset_caches()


@pytest.fixture
def table():
    """DynamoDB table shaped like infra/modules/data."""
    with mock_aws():
        ddb = boto3.client("dynamodb")
        keys = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK"]
        ddb.create_table(
            TableName=TABLE,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k in keys],
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": g,
                    "KeySchema": [
                        {"AttributeName": f"{g}PK", "KeyType": "HASH"},
                        {"AttributeName": f"{g}SK", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
                for g in ("GSI1", "GSI2")
            ],
        )
        boto3.client("s3").create_bucket(Bucket=BUCKET)
        yield boto3.resource("dynamodb").Table(TABLE)


@pytest.fixture
def client(table):
    from app.main import create_app

    return TestClient(create_app())


def dev_headers(sub="user-1", email="alex@example.com"):
    return {"X-Dev-User": sub, "X-Dev-Email": email}
