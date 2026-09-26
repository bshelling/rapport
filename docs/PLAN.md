# Rapport — Build & Ship Plan (AWS "Zero to Shipped" Hackathon)

## Context
Greenfield repo (`/Users/shelling/Projects/rapport` holds only `project_spec.md`). Ship a live, public-URL app on AWS by **Oct 2, 2026** that lets New Orleans residents report **Roads and Streets** and **Drainage** issues, mirroring the NOLA 311 form, with an AI workflow doing the processing behind the scenes.
Submission: **#social-good (climate resilience: clogged catch basins → street flooding) + #community**. Ship gate is pass/fail: live URL + documented proof that Claude Code was connected to AWS.
Environment verified: bun, node 22, python3, terraform, aws CLI (acct 322673434521, user `gusoadmin`), `gh` logged in as **bshelling** (repo, workflow scopes). Region **us-east-1**.

## 1. Foundations
- Monorepo: `web/` (Next.js + Bun) · `api/` (FastAPI + worker + shared services) · `agent/` (AgentCore agent) · `ingest/` (NOLA 311 Lambda) · `infra/` (Terraform) · `docs/` · `.github/`.
- Frontend: Next.js static export → S3 + CloudFront (default `*.cloudfront.net` URL). Detail pages use `?id=` query routes.
- Auth: Cognito Hosted UI (email/password, self sign-up). Home/map public; reporting requires sign-in. API Gateway JWT authorizer.
- Get a hello page + `/health` live on day 1.

## 2. Data model (DynamoDB single table `rapport`, on-demand)
- Request types/reasons use **exact city strings** (verified from `2jgv-pqrq`):
  - **Roads and Streets** → Pothole · Sidewalk Damaged or Missing · Street Subsidence (Sinking)
  - **Drainage** → Catch Basin Not Draining · Catch Basin Clogged · Catch Basin Frame and Cover Missing or Damaged · Drainage Manhole Cover Missing or Damaged · Street Flooding
- Items: `USER#{sub}/PROFILE` (first/last name, email, phone + type, neighborhood, prefs) · `DRAFT#{id}/META` (step data + `insights`) · `REPORT#{id}/META` (request_type, request_reason, contact, address, lat/lng, geohash, basin_id, neighborhood, description sanitized HTML, photo_keys ≤3, photo_public flag, ai assessment, status, nola311_ticket, supporter_count, timestamps, seed flag) · `REPORT#{id}/EVENT#{ts}` (timeline, source user|nola311|ai) · `REPORT#{id}/SUPPORT#{sub}` (+1 w/ optional photo) · `NOLA311#{ticket}/META` · `BASIN#{gisid}/META` · `STATS#latest` · rate-limit counters.
- GSI1: user → reports by date (dashboard). GSI2: geohash6 → type#date (map, dupes; Rapport + city records).
- Statuses: submitted → filed_with_311 → in_progress → resolved | closed_duplicate.
- Public map is anonymous; contact info never public. EXIF GPS prefills location, then EXIF stripped from stored copy.
- Pydantic models = source of truth → OpenAPI → `openapi-typescript` for web types.

## 3. Backend API (FastAPI + Mangum, Lambda py3.12 arm64, uv)
- Draft-centric: `POST /drafts` → `PATCH /drafts/{id}` per modal step → async-invokes **worker Lambda** (fixed pipeline) that writes `insights` → UI polls `GET /drafts/{id}` (~1.5 s) → `POST /drafts/{id}/submit`.
- Endpoints: `/health`, `/service-catalog`, `/map/reports?bbox=`, `/stats`, `/me` GET/PUT, `/drafts` (+`/photos` presigned PUT, `/submit`), `/reports/mine`, `/reports/{id}` GET (owner vs redacted)/PATCH (311 ticket), `/reports/{id}/support`, `/geocode`, `/geocode/reverse` (Amazon Location, NOLA-biased), `/agent/chat` (non-streaming).
- Layout: `api/app/routers/` thin; `api/app/services/` (drafts, reports, triage, dupes, geo, nola311, jev, stats) shared by API, worker, ingest, agent.

## 4. Frontend
- Next.js App Router + TS, Tailwind + shadcn/ui, Framer Motion, TanStack Query, react-hook-form + zod, Tiptap, MapLibre + Amazon Location tiles, aws-amplify/auth.
- Pages: `/` (hero, anonymous live map w/ catch-basin layer toggle, impact stats incl. Francine callout, CTA) · `/dashboard` · `/reports/view?id=` (photos, AI assessment, timeline, 311 hand-off + ticket field, +1) · `/profile`.
- **Report modal** (global + `/report`), animated 3 steps: (1) Request type cards → reason chips + "Not sure? Snap a photo"; (2) Contact info prefilled from profile + "save to profile"; (3) Location (GPS/pin/search), ≤3 photos, Tiptap description, live **insights panel** (suggestions with one-tap accept, never silent autofill) → success screen.
- Chat: floating "Ask Rapport" → drawer/bottom sheet; chat drafts open the modal at step 3 for review.
- Style: clean civic, restrained NOLA accents (deep green/purple/gold), dark mode, mobile-first.

## 5. AI features
- Model: **Claude Opus 5 on Bedrock** (`anthropic.claude-opus-5`) via `anthropic.AnthropicBedrockMantle(aws_region="us-east-1")`, low effort, structured outputs; check `stop_reason` before reading content.
- **Triage**: Claude vision → {scene_description, visible_objects, landmarks, image_quality, contains_person_or_plate} → **Jev** (`typesafe-sdk`, `TypeSafeClient().system_one`): `request_reason` Choice (8 reasons + not_an_issue), `severity` Score (4 levels), `is_actionable_public_issue` / `safety_hazard` / `matches_user_selection` Noul. Confidence routing: ≥0.8 green chip; medium amber top-2; low → "try a closer photo". Claude drafts a 311-style description.
- Person/plate detected → photo owner-only; public pin without photo.
- **Dupes**: GSI2 candidates ≤75 m, same type, open, ≤90 days → Jev Noul "same physical issue" (top ~5); ≥0.7 → "+1 instead" or link to city ticket.
- Per-call timeouts; partial insights OK; submission never blocked. Fixtures + ~10-photo eval set.
- Jev key → SSM SecureString `/rapport/typesafe_api_key` (user has key).

## 6. Agent
- **Strands Agents** on **AgentCore Runtime** (arm64 container, ECR) + **AgentCore Memory**; Claude Opus 5 on Bedrock.
- Invoked only by API Lambda role via `/agent/chat` with `{user_sub, session_id, message}`; tools scope to passed `user_sub`.
- Tools: get_service_catalog, geocode_address/reverse_geocode, classify_issue, find_nearby_reports, create_report_draft, request_photo, list_my_reports, get_report_status, explain_next_steps.
- Agent drafts only → "Review & submit" card; user confirms in modal.
- Guardrails: Jev on-topic Noul pre-check; 30 msgs/session; per-user daily cap; ≤3 tool steps/turn.

## 7. NOLA 311 integration
- Datasets: `2jgv-pqrq` (311 calls; `service_request, request_type, request_reason, request_status Pending|Closed, date_created, date_modified, final_address, latitude, longitude`), `se4p-ierc` (Catch Basins), `ezfk-aiyx` (Francine calls).
- Ingest Lambda (EventBridge nightly 3am CT): 24-month backfill, then incremental on `date_modified`. One-time basin import; drainage reports tagged with nearest basin + neighborhood.
- Status sync: pasted ticket validated live; Pending → filed_with_311/in_progress, Closed → resolved; EVENT source `nola311`.
- Auto-match (no ticket): ≤30 m, same reason, ±72 h, Jev ≥0.85 → suggest link; user confirms.
- `STATS#latest` nightly: open drainage by neighborhood, reports per 100 basins, median days-to-close, potholes reported vs closed, Francine callout, Rapport metrics. Optional Socrata app token in SSM.

## 8. Infra, CI/CD & PR workflow
- `infra/bootstrap/` (local, once): state bucket (native lockfile), GitHub OIDC provider, read-only plan role (PRs), deploy role (main + `prod` env), **`rapport-claude-code` role/profile** for Claude Code.
- `infra/` modules: web, auth, data, api, worker, agent, ingest, observability (alarms, Budgets $50/$100). Prod only, parameterized by `env`.
- Public repo `bshelling/rapport`; branches `feat/ fix/ infra/ docs/`; conventional commits; protected main (PR + green checks, squash, linear, delete branch).
- **Claude opens PRs; user reviews and merges.** Each PR includes a **Verification** section: Tests (focused logic + integration) · Runtime (feature exercised end to end) · Visual (**Playwright** screenshots, desktop + mobile) · Confidence (what was / wasn't verified).
- Lint: **Ruff** (Python), **Biome** via `bunx biome` (web; Bun has no built-in linter), `tsc --noEmit`.
- `ci.yml` (path-filtered): web (biome, tsc, `bun test`, `next build`, Playwright smoke) · api/agent (ruff, pytest+moto, docker build) · infra (fmt, validate, tflint, plan → PR comment).
- `deploy.yml` on main: build zips + agent image → `terraform apply` → web build → S3 sync → invalidation → smoke `/health` + home → URL in summary.

## 8b. Local development (MiniStack + NoSQL Workbench for DynamoDB)
- `docker-compose.yml` runs **MiniStack** on `:4566` (DynamoDB, S3, SSM, Lambda, EventBridge). `infra/envs/local/` applies the same `data` module (table + GSIs, photo bucket, SSM params) against MiniStack via provider `endpoints` overrides, so local and prod schemas never drift.
- App config: `AWS_ENDPOINT_URL=http://localhost:4566` in `.env.local`; boto3/SDKs pick it up. Services not emulated (Bedrock, AgentCore, Cognito, Location, Jev) use fakes behind their interfaces by default (`RAPPORT_AI=fake`), or real AWS via `RAPPORT_AI=live`. Local auth: dev-only JWT bypass (`RAPPORT_AUTH=dev`, never deployed).
- `make dev` (or `bun run dev:all`): compose up → terraform apply local → seed script → `uvicorn` API with reload + `next dev`.
- **NoSQL Workbench**: committed data model `docs/dynamodb/rapport.workbench.json` (one facet per item type + sample data) for visualizing access patterns; connect Workbench's operation builder to `localhost:4566` to browse and edit local data. Workbench model is kept in sync with Pydantic models (checked in PR review).

## 9. Hackathon deliverables
- `.mcp.json` with awslabs AWS API, AgentCore and Terraform MCP servers using the `rapport-claude-code` profile.
- `docs/AGENT_PROOF.md`: MCP config, session screenshots/transcripts (sts, terraform apply, Bedrock/AgentCore deploys, CloudWatch debugging), CloudTrail lookup for the role, PR links.
- Demo judge account (preloaded statuses); ~25 seeded reports using **user's own NOLA photos**; one full storyline incl. real closed city ticket sync.
- `docs/SUBMISSION.md`: problem with real city numbers, audience, measurable impact, architecture diagram, AI pipeline, how Claude Code helped, roadmap, tags `#social-good #community`. 2–3 min demo video (Playwright footage + user voiceover).

## PR sequence & schedule (Sep 26 → Oct 2)
| Day | PRs |
|---|---|
| Sep 26–27 | `infra/bootstrap` · `feat/skeleton-live` (web shell + `/health`, CI/deploy pipelines; **public URL live**) · `feat/auth-profile` |
| Sep 28 | `feat/report-drafts` (catalog, drafts, photo upload, 3-step modal, submit) · `feat/dashboard-details` |
| Sep 29 | `feat/photo-triage` (Bedrock + Jev, insights panel) · `feat/geo-map` (Location, map, EXIF) · `feat/duplicates` (+1 supporters) |
| Sep 30 | `feat/nola311-ingest` (backfill, basins, status sync, auto-match) · `feat/impact-stats` |
| Oct 1 | `feat/agent` (AgentCore runtime + memory, chat drawer) |
| Oct 2 | `feat/polish-seed` (seed data, demo account, mobile/dark pass) · `docs/submission` (proof, story, diagram, video) → submit |
Cut order if behind: chat status Q&A → auto-match → chat reporting → Francine callout (keep triage, dupes, 311 sync, live app).

## Verification (overall)
- Per PR: Tests / Runtime / Visual (Playwright) / Confidence sections as above.
- Final E2E on the deployed URL (Playwright + manual phone check): sign up → 3-step report with real photo → triage chips → duplicate suggestion vs seeded report → submit → dashboard → detail → paste real 311 ticket → run ingest Lambda (`aws lambda invoke`) → status updates → chat "status of my reports?" → incognito check that home/map load without auth.
- Confirm CloudTrail shows `rapport-claude-code` activity; Budgets alarms exist.

## First actions on approval
1. Save a feedback memory: PR proof/confidence requirement; Playwright, Ruff, Biome preferences.
2. `git init`, create public `bshelling/rapport`, add spec + plan to `docs/`.
3. Start `infra/bootstrap` PR.
