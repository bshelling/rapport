#!/usr/bin/env bash
# Package the chat agent for AgentCore Runtime direct code deployment (python3.12, arm64).
# The agent reuses the API's services, so api/app ships alongside it.
# Usage: scripts/build-agent-zip.sh [output-zip]   (default: dist/agent.zip)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist/agent.zip}"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

cd "$ROOT/agent"
uv export --frozen --no-dev --no-hashes --no-emit-project -o "$BUILD/requirements.txt" >/dev/null
uv pip install -q \
  --target "$BUILD/pkg" \
  --python-platform aarch64-manylinux2014 \
  --python-version 3.12 \
  --only-binary=:all: \
  -r "$BUILD/requirements.txt"
cp -R rapport_agent main.py "$BUILD/pkg/"
cp -R "$ROOT/api/app" "$BUILD/pkg/app"
find "$BUILD/pkg" -name "__pycache__" -type d -prune -exec rm -rf {} +
# The runtime runs as a non-root user: everything readable, directories traversable.
chmod -R u=rwX,go=rX "$BUILD/pkg"
# Fixed timestamps and order keep the zip identical across builds of the same code,
# so the runtime only redeploys when something changed.
find "$BUILD/pkg" -exec touch -h -t 202601010000 {} +

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$BUILD/pkg" && find . -type f | LC_ALL=C sort | zip -q -X -@ "$OUT")
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
