from functools import lru_cache

import boto3

from app.config import get_settings


@lru_cache
def get_table():
    # AWS_ENDPOINT_URL (MiniStack locally) is honored by boto3 automatically.
    settings = get_settings()
    return boto3.resource("dynamodb", region_name=settings.aws_region).Table(settings.table_name)
