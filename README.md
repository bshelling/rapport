# Rapport

Report potholes, street damage and clogged catch basins in New Orleans — with an AI assistant that does the paperwork.

Rapport mirrors the NOLA 311 service request form (Roads and Streets, Drainage), triages photos with Claude on Amazon Bedrock and TypeSafe Jev, flags duplicates, and syncs status from the City's public 311 data.

## Architecture

```
Browser ── CloudFront ──┬── S3            Next.js static export (web/)
                        └── /api/* ── API Gateway (HTTP) ── Lambda: FastAPI (api/)
                                                              └── DynamoDB · S3 photos
```

Infrastructure is Terraform (`infra/`): `modules/{data,api,web}`, composed by `envs/prod` and, for local development, `envs/local`.

## Local development

Requirements: Docker, [Bun](https://bun.sh), [uv](https://docs.astral.sh/uv/), Terraform ≥ 1.10.

```sh
make local-up     # MiniStack on :4566 + table/bucket from the Terraform data module + sample data
make api          # FastAPI on http://localhost:8000 (docs at /api/docs)
make web          # Next.js on http://localhost:3000
```

Copy `web/.env.example` to `web/.env.local` so the site calls the local API.

- **MiniStack** ([ministack.org](https://ministack.org)) emulates DynamoDB, S3 and friends locally. `make local-infra` resets it and re-applies `infra/envs/local`.
- **NoSQL Workbench for DynamoDB**: import `docs/dynamodb/rapport.workbench.json` to explore the single-table design (one facet per item type). To browse live local data, add a DynamoDB local connection on port `4566`. `make seed` loads the model's sample items into the local table.

## Checks

```sh
make lint         # Ruff, Biome, tsc, terraform fmt
make test         # pytest + bun test
make e2e          # Playwright against BASE_URL (default http://localhost:3000)
```

CI runs these on every pull request and posts the Terraform plan; merging to `main` deploys to production.
