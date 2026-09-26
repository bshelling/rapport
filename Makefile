.PHONY: local-up local-down local-infra seed api web test e2e lint build-api

LOCAL_AWS = AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test

## Start MiniStack and create the table + bucket from the Terraform data module.
local-up:
	docker compose up -d --wait ministack
	$(MAKE) local-infra
	$(MAKE) seed

# Reset MiniStack and rebuild from the Terraform data module so local state
# and the emulator always agree.
local-infra:
	curl -sf -X POST http://localhost:4566/_ministack/reset >/dev/null
	cd infra/envs/local && rm -f terraform.tfstate terraform.tfstate.backup && \
		terraform init -input=false -upgrade >/dev/null && \
		terraform apply -input=false -auto-approve

## Load NoSQL Workbench sample data (docs/dynamodb) into the local table.
seed:
	uv run -q --with boto3 scripts/seed-local.py

local-down:
	docker compose down

## Run the API (http://localhost:8000) against MiniStack.
api:
	cd api && $(LOCAL_AWS) RAPPORT_TABLE_NAME=rapport-local RAPPORT_PHOTO_BUCKET=rapport-photos-local \
		uv run uvicorn app.main:app --reload --port 8000

## Run the web app (http://localhost:3000).
web:
	cd web && bun run dev

test:
	cd api && uv run pytest -q
	cd web && bun test

## Playwright against a running site (BASE_URL, default http://localhost:3000).
e2e:
	cd web && bunx playwright test

lint:
	cd api && uv run ruff check . && uv run ruff format --check .
	cd web && bunx biome check . && bun run typecheck
	terraform fmt -check -recursive infra

build-api:
	scripts/build-api-zip.sh
