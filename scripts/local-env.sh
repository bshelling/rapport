#!/usr/bin/env bash
# Write web/.env.local and api/.env for local development against the real
# Cognito user pool (read from the prod Terraform outputs) and MiniStack.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tf() { terraform -chdir="$ROOT/infra/envs/prod" output -raw "$1"; }

POOL=$(tf user_pool_id)
CLIENT=$(tf user_pool_client_id)
DOMAIN=$(tf auth_domain)
REGION=us-east-1
# Map tile key (exists once infra/modules/maps is deployed); empty = plain background.
MAP_KEY=$(aws location describe-key --key-name "$(tf map_key_name 2>/dev/null || echo rapport-maps-prod)" \
  --query Key --output text 2>/dev/null || true)

cat > "$ROOT/web/.env.local" <<ENV
NEXT_PUBLIC_API_BASE=http://localhost:8000
NEXT_PUBLIC_COGNITO_USER_POOL_ID=$POOL
NEXT_PUBLIC_COGNITO_CLIENT_ID=$CLIENT
NEXT_PUBLIC_COGNITO_DOMAIN=$DOMAIN
NEXT_PUBLIC_MAP_API_KEY=$MAP_KEY
ENV

cat > "$ROOT/api/.env" <<ENV
RAPPORT_ENVIRONMENT=local
RAPPORT_AUTH_MODE=jwt
RAPPORT_COGNITO_ISSUER=https://cognito-idp.$REGION.amazonaws.com/$POOL
RAPPORT_COGNITO_CLIENT_ID=$CLIENT
ENV
echo "wrote web/.env.local and api/.env (pool $POOL)"
