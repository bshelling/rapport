"""Delete everything the Playwright test user created in an environment:
reports (with their events, supporters and photos) and drafts.

Usage: uv run --with boto3 scripts/cleanup-e2e.py <env>   (e.g. prod, local)
Uses normal AWS credentials. For "local", DynamoDB/S3 go to MiniStack while the
test user's id is still looked up in the real Cognito pool.
"""

import sys

import boto3
from boto3.dynamodb.conditions import Attr, Key

E2E_EMAIL = "e2e@example.com"
REGION = "us-east-1"


def e2e_sub(env: str) -> str:
    if env == "local":
        # Local runs sign in against the prod pool, so the sub is the same.
        env = "prod"
    idp = boto3.client("cognito-idp", region_name=REGION)
    pool = next(
        p["Id"]
        for p in idp.list_user_pools(MaxResults=60)["UserPools"]
        if p["Name"] == f"rapport-{env}"
    )
    user = idp.admin_get_user(UserPoolId=pool, Username=E2E_EMAIL)
    return next(a["Value"] for a in user["UserAttributes"] if a["Name"] == "sub")


def _all(call, **kwargs) -> list[dict]:
    """Every page of a query or scan. A single page is capped at 1 MB, and the table
    holds thousands of NOLA 311 items, so one page misses most drafts."""
    items: list[dict] = []
    while True:
        res = call(**kwargs)
        items += res["Items"]
        if "LastEvaluatedKey" not in res:
            return items
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def main(env: str) -> None:
    sub = e2e_sub(env)
    if env == "local":
        local = boto3.Session(
            aws_access_key_id="test",
            aws_secret_access_key="test",  # noqa: S106 (MiniStack dummy credentials)
            region_name=REGION,
        )
        endpoint = "http://localhost:4566"
        ddb = local.resource("dynamodb", endpoint_url=endpoint)
        s3 = local.client("s3", endpoint_url=endpoint)
        bucket = "rapport-photos-local"
    else:
        ddb = boto3.resource("dynamodb", region_name=REGION)
        s3 = boto3.client("s3", region_name=REGION)
        account = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
        bucket = f"rapport-photos-{env}-{account}"
    table = ddb.Table(f"rapport-{env}")

    reports = _all(
        table.query, IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"USER#{sub}")
    )
    deleted_items = deleted_photos = 0
    with table.batch_writer() as batch:
        for report in reports:
            pk = report["PK"]
            for item in table.query(KeyConditionExpression=Key("PK").eq(pk))["Items"]:
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
                deleted_items += 1
            for key in report.get("photo_keys", []):
                s3.delete_object(Bucket=bucket, Key=key)
                deleted_photos += 1
        drafts = _all(
            table.scan,
            FilterExpression=Attr("PK").begins_with("DRAFT#") & Attr("user_sub").eq(sub),
        )
        for draft in drafts:
            batch.delete_item(Key={"PK": draft["PK"], "SK": draft["SK"]})
            for photo in draft.get("photos", []):
                s3.delete_object(Bucket=bucket, Key=photo["key"])
                deleted_photos += 1
    # The seeded "neighbor" report and fake City request (scripts/seed-e2e.py), with
    # the +1s and link pointers the tests added to them.
    with table.batch_writer() as batch:
        batch.delete_item(Key={"PK": "NOLA311#2099-0000001", "SK": "META"})
        for item in table.query(KeyConditionExpression=Key("PK").eq("TICKET#2099-0000001"))[
            "Items"
        ]:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
        for item in table.query(KeyConditionExpression=Key("PK").eq("REPORT#e2e-neighbor-pothole"))[
            "Items"
        ]:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    print(
        f"{env}: removed {len(reports)} reports ({deleted_items} items), "
        f"{len(drafts)} drafts, {deleted_photos} photos for {E2E_EMAIL}"
    )


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "prod")
