#!/usr/bin/env bash
# Package the FastAPI app as an AWS Lambda zip (python3.12, arm64).
# Usage: scripts/build-api-zip.sh [output-zip]   (default: dist/api.zip)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist/api.zip}"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

cd "$ROOT/api"
# boto3/botocore ship with the Lambda Python runtime; leave them out.
uv export --frozen --no-dev --no-hashes --no-emit-project \
  --no-emit-package boto3 --no-emit-package botocore \
  --no-emit-package s3transfer --no-emit-package jmespath \
  -o "$BUILD/requirements.txt" >/dev/null
uv pip install -q \
  --target "$BUILD/pkg" \
  --python-platform aarch64-manylinux2014 \
  --python-version 3.12 \
  --only-binary=:all: \
  -r "$BUILD/requirements.txt"
cp -R app "$BUILD/pkg/app"
find "$BUILD/pkg" -name "__pycache__" -type d -prune -exec rm -rf {} +
# Fixed permissions, timestamps and order keep the zip identical across builds of the
# same code, so the Lambdas only update when something changed.
chmod -R u=rwX,go=rX "$BUILD/pkg"
find "$BUILD/pkg" -exec touch -h -t 202601010000 {} +

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$BUILD/pkg" && find . -type f | LC_ALL=C sort | zip -q -X -@ "$OUT")
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
