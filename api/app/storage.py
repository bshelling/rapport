import os
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import get_settings

MAX_PHOTO_BYTES = 8 * 1024 * 1024
URL_TTL_SECONDS = 900


@lru_cache
def _s3():
    settings = get_settings()
    # Local emulators (AWS_ENDPOINT_URL) need path-style URLs.
    style = "path" if os.environ.get("AWS_ENDPOINT_URL") else "virtual"
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": style}),
    )


def _bucket() -> str:
    return get_settings().photo_bucket


def presign_upload(key: str) -> dict:
    """Browser uploads straight to S3; S3 enforces type and size."""
    return _s3().generate_presigned_post(
        Bucket=_bucket(),
        Key=key,
        Fields={"Content-Type": "image/jpeg"},
        Conditions=[
            {"Content-Type": "image/jpeg"},
            ["content-length-range", 1024, MAX_PHOTO_BYTES],
        ],
        ExpiresIn=URL_TTL_SECONDS,
    )


def presign_get(key: str) -> str:
    return _s3().generate_presigned_url(
        "get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=URL_TTL_SECONDS
    )


def exists(key: str) -> bool:
    try:
        _s3().head_object(Bucket=_bucket(), Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise
    return True


def move(src: str, dst: str) -> None:
    s3 = _s3()
    s3.copy_object(Bucket=_bucket(), Key=dst, CopySource={"Bucket": _bucket(), "Key": src})
    s3.delete_object(Bucket=_bucket(), Key=src)


def delete(key: str) -> None:
    _s3().delete_object(Bucket=_bucket(), Key=key)
