from decimal import Decimal
from functools import lru_cache
from typing import Any

import boto3

from app.config import get_settings


@lru_cache
def get_table():
    # AWS_ENDPOINT_URL (MiniStack locally) is honored by boto3 automatically.
    settings = get_settings()
    return boto3.resource("dynamodb", region_name=settings.aws_region).Table(settings.table_name)


def to_dynamo(value: Any) -> Any:
    """DynamoDB rejects Python floats; convert them (recursively) to Decimal."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


def from_dynamo(value: Any) -> Any:
    """Inverse of to_dynamo for values read back from DynamoDB."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: from_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [from_dynamo(v) for v in value]
    return value
