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

cat > "$ROOT/web/.env.local" <<ENV
NEXT_PUBLIC_API_BASE=http://localhost:8000
NEXT_PUBLIC_COGNITO_USER_POOL_ID=$POOL
NEXT_PUBLIC_COGNITO_CLIENT_ID=$CLIENT
NEXT_PUBLIC_COGNITO_DOMAIN=$DOMAIN
ENV

cat > "$ROOT/api/.env" <<ENV
RAPPORT_ENVIRONMENT=local
RAPPORT_AUTH_MODE=jwt
RAPPORT_COGNITO_ISSUER=https://cognito-idp.$REGION.amazonaws.com/$POOL
RAPPORT_COGNITO_CLIENT_ID=$CLIENT
ENV
echo "wrote web/.env.local and api/.env (pool $POOL)"
