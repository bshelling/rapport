import boto3
import pytest
from moto import mock_aws

TABLE = "rapport-test"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for k in ("AWS_ENDPOINT_URL", "AWS_PROFILE", "RAPPORT_AGENT_MEMORY_ID"):
        monkeypatch.delenv(k, raising=False)
    for k, v in {
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "RAPPORT_ENVIRONMENT": "test",
        "RAPPORT_TABLE_NAME": TABLE,
        "RAPPORT_PHOTO_BUCKET": "rapport-photos-test",
        "RAPPORT_AI_MODE": "fake",
        "RAPPORT_GEO_MODE": "fake",
    }.items():
        monkeypatch.setenv(k, v)
    from app import db, storage
    from app.config import get_settings
    from app.services import geo, jev

    for fn in (get_settings, db.get_table, storage._s3, geo.get_geo, jev.get_jev):
        fn.cache_clear()
    yield


@pytest.fixture
def table():
    with mock_aws():
        ddb = boto3.client("dynamodb")
        keys = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK"]
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
                for g in ("GSI1", "GSI2", "GSI3")
            ],
        )
        boto3.client("s3").create_bucket(Bucket="rapport-photos-test")
        yield boto3.resource("dynamodb").Table(TABLE)
