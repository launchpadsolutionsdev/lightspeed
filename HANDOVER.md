# Lightspeed — Engineering Handover

For the team receiving the codebase. Frank about current state rather than polished.

Companion docs: `README.md`, `DEPLOYMENT.md`, `LICENSE` (MIT).

---

## 1. What it is

AI-assisted productivity SaaS for hospital foundations and charitable-gaming organizations running lotteries. Staff paste inquiries or data; the app drafts responses, analyzes sales, and automates calendars/content.

Runs on a single Render web instance + managed Postgres. Designed for a small number of customer orgs and single-digit concurrent users at time of handover.

---

## 2. Architecture

```
Frontend (static vanilla JS on Render Static)
    │  HTTPS
    ▼
Backend (Node 22 / Express on Render Web)
    ├── Postgres (Render managed)
    ├── Anthropic Claude (raw fetch, no SDK)
    ├── Voyage AI (embeddings for KB search)
    ├── Stripe (billing)
    ├── Shopify Admin API (per-org store sync)
    ├── Google + Microsoft OAuth
    └── Gmail SMTP (transactional email)
```

Entry: `backend/src/index.js`. Routes under `/api/*`. Migrations in `backend/migrations/` auto-run on startup in filename order.

---

## 3. Repo layout

```
/backend
  /src
    index.js          — app entry, migrations, scheduled jobs
    /routes           — Express routers per domain
    /services         — logger, email, claude, shopify, encryption,
                        urlValidator, tbrhsfSeeder, superAdminBootstrap
    /middleware       — auth, rate limiting
  /migrations         — 65 .sql files
  /data               — compliance KB seed JSON + tbrhsf-seed.json
  /__tests__          — Jest suites (~27 suites, 452 tests)

/frontend
  index.html          — marketing + SPA app, single file
  app.js              — client logic
  msal-browser.min.js — vendored MSAL browser bundle

render.yaml           — blueprint (informational; live service is
                        configured via the Render dashboard)
```

---

## 4. Multi-tenant model

- Unit of tenancy: `organizations`. Business tables carry `organization_id`.
- Users are **global**, joined to orgs via `organization_memberships` with a role (`owner`/`admin`/`member`).
- `backend/src/middleware/auth.js` sets `req.organizationId` from the `X-Organization-Id` header, falling back to the caller's first membership.
- Super-admin is a **platform-operator flag** (`users.is_super_admin`), distinct from customer roles. Grant via `SUPER_ADMINS` env var.

Known schema gaps:
- `feedback`, `audit_logs`, `usage_logs` use nullable `organization_id ... ON DELETE SET NULL`. Orphaned rows persist after org deletion. Queries in these tables must always filter by org.
- `home_base_posts.organization_id` is nullable to support global posts; code branches on `is_global`. Fragile.

---

## 5. Required environment variables

Beyond the standard ones (DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID, FRONTEND_URL, NODE_ENV), the service needs:

| Var | Purpose | Notes |
|-----|---------|-------|
| `ENCRYPTION_KEY` | AES-256-GCM key for Shopify token encryption | 32 bytes, base64 or hex. Generate: `openssl rand -base64 32`. **Permanent** — losing it means re-connecting every Shopify store. |
| `SUPER_ADMINS` | Comma-separated emails granted `is_super_admin` on startup | Additive only; never demotes. |
| `SEED_TBRHSF` | Set to `true` to load TBRHSF-specific profile / content / KB from `backend/data/tbrhsf-seed.json` at startup | Off in the generalized product. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth. If either is empty the app fails to boot (MSAL validates credentials eagerly at construction time). | |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | Billing | |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Shopify Partner app | |
| `VOYAGE_API_KEY` | Voyage embeddings for KB semantic search | |
| `SMTP_HOST/PORT/USER/PASS`, `FROM_EMAIL`, `FROM_NAME`, `CONTACT_EMAIL` | Transactional email | |
| `BACKEND_URL`, `DASHBOARD_FEED_URL` | Runtime URLs | |

`render.yaml` does not list all of these — they're set via the Render dashboard on the `lightspeed-api` service.

---

## 6. Operational considerations

### Deployment
- Render auto-deploys `main`.
- Migrations run on every startup (no version table — tracked via a `_migration_flags` row inside each DO block). Idempotent in aggregate. A fresh Postgres stand-up works end-to-end; spot-check output.
- Migration `004_reset_organization_memberships.sql` is a one-time destructive reset gated by a flag — preserve the flag row across DB restores.

### Scheduled jobs (single-instance assumption)
`backend/src/index.js` runs 5 in-process `setInterval` tasks: calendar reminders (60s), Home Base scheduled post publisher (60s), digest emails (1h), Shopify analytics sync (15m), data retention cleanup (24h). No distributed locking. **Scaling web tier to >1 instance will cause duplicate emails, posts, and API calls.** Fix before scaling: move jobs to a dedicated worker + queue (BullMQ/Redis).

### Observability
JSON logs to stdout. `GET /health` checks DB + Anthropic. No APM — log-based investigation only.

---

## 7. Pre-handover fixes shipped (context for the changelog)

Addressed in the final batch before transfer:

- **Usage-limit middleware** re-enabled with full subscription-tier enforcement and tests unskipped.
- **Invite-accept** now verifies the invitee email matches the caller to prevent token-forward attacks.
- **Feedback list** scoped to the caller's org by default; super-admin global view requires `?scope=all`.
- **Feed-dashboard SSRF** closed via `services/urlValidator.js` (blocks private/loopback/metadata-IP resolutions on both save and fetch paths).
- **Shopify access tokens** now AES-256-GCM encrypted at rest via `services/encryption.js`. Legacy plaintext rows upgrade lazily on next save.
- **Hardcoded super-admin grant** (migration 061) moved to `SUPER_ADMINS` env var bootstrap.
- **TBRHSF-specific seed data** extracted from migrations 005/006/009 into a runtime loader gated by `SEED_TBRHSF`. Generalized product ships with no customer-specific content.
- **Migration filename collisions** (`049_*` × 2, `052_*` × 2) disambiguated to `049a/049b`, `052a/052b`.
- **Unused `@anthropic-ai/sdk` dependency** removed (was declared but never imported; integration uses raw `fetch` to the Anthropic API).

Full commit history on branch `claude/investigate-render-logs-zIPJQ`.

---

## 8. Remaining debt (not blocking, but worth knowing)

### Security / correctness
- Contact form (`routes/contact.js`) is unauthenticated; invite/password-reset endpoints rely on the global IP rate limit, which enables email enumeration.
- Uploaded PDFs/DOCX/XLSX are parsed without AV scanning.
- Shopify OAuth callback verifies HMAC but does not validate the nonce is single-use.

### Architecture
- Monolithic route files: `homeBase.js` (~2.3k lines), `askLightspeed.js` (~1.9k), `shopifyAnalytics.js` (~1.9k).
- Frontend is a single 20k-line `index.html` + 24k-line `app.js`, no bundler, no modules.
- Prompt-builder logic duplicated across `systemPromptBuilder.js`, `draftPromptBuilder.js`, `compliancePromptBuilder.js`.
- Error response shapes vary (`{error}` vs. `{code, message}`).
- Several empty `catch` blocks swallow errors silently (see `askLightspeed.js:777, 1239, 1252`).

### Schema
- Missing indexes on FK columns like `knowledge_base.created_by`, `home_base_posts.author_id`.
- `compliance_conversations` / `compliance_messages` define `org_id` / `user_id` without FK constraints.
- Nullable-org-id tables noted in §4.

### Tests / tooling
- Route test coverage ~49% by file. No multi-tenant isolation test. Billing webhook edge cases untested.
- CI `--max-warnings 25` allows lint debt to accumulate.

### Content / licensing
- `OntarioPDF-FIles/` contains Ontario AGCO Lottery Licensing Policy Manual content used to build the compliance KB. AGCO material is subject to Ontario's Open Government License — confirm redistribution terms before expanding the commercial deployment.

### Frontend specifics
- `frontend/msal-browser.min.js` is a vendored minified MSAL bundle. Move to npm + SRI.
- CDN assets (SheetJS, Chart.js, html2pdf) load without `integrity` attributes.
- JWT stored in `localStorage` — XSS would leak the session. Moving to httpOnly cookies requires a backend cookie path.
- Backend URL hardcoded in `frontend/app.js:124`. Rebranding/repointing is a code change.
- Google OAuth client ID in source is **expected and not a secret** — OAuth client IDs for browser clients are public by design.

---

## 9. External services — transfer checklist

| Service | Complexity | Notes |
|---------|------------|-------|
| Render (web + static + Postgres + domain) | Medium | Supports team transfers; Postgres may need dump/restore across orgs. |
| Stripe (account, products, webhooks, subscriptions) | High | Entity-bound; may need Stripe support for customer/subscription migration. |
| Shopify Partner (OAuth app, webhooks) | High | App transfer requires Shopify approval; merchants may need to reinstall. |
| Google Cloud / OAuth (consent screen, client ID) | Medium | Users may need re-consent; app verification may need re-submission. |
| Microsoft / Azure AD app | Medium | Similar to Google. |
| Anthropic / Voyage AI API keys | Low | Issue new keys. |
| Gmail SMTP | Low | Swap credentials, or move to Postmark/SendGrid. |
| GitHub repo | Low | Standard transfer. |
| DNS / registrar for `lightspeedutility.ca` | Medium | Update nameservers / registrar account. |

---

## 10. Getting started

1. Read `backend/src/index.js` end-to-end — it's the map: CORS, auth, rate limits, every mounted router, every `setInterval`, the migration runner.
2. Read `backend/src/middleware/auth.js` — understand how `req.user` and `req.organizationId` are set.
3. Trace one request end-to-end: e.g. `frontend/app.js` → `/api/response-history` → `backend/src/routes/responseHistory.js` → Postgres.
4. Read migrations in filename order for the authoritative schema history.
5. `cd backend && npm ci && npm test` — all suites should pass.
6. Hit `/health` in production or staging.

Places to avoid making your first changes:
- `homeBase.js`, `askLightspeed.js`, `shopifyAnalytics.js` — large files with subtle state.
- The migration runner and `_migration_flags` table — small changes can brick fresh environments.
- Scheduled jobs in `index.js` — easy to create duplicate email storms.

---

## 11. Suggested early priorities

- Sentry (or equivalent) for error tracking.
- Extract scheduled jobs to a dedicated worker service so the web tier can scale.
- Pin Node version in `backend/package.json` (`"engines": { "node": "22.x" }`).
- Reconcile `render.yaml` with the live dashboard configuration, or drop the blueprint.
- Add one cross-tenant isolation test — small investment, large reassurance.
- Consider adopting the Anthropic SDK to enable prompt caching (real cost reduction on the large system prompts).

---

_Last updated at handover. Keep current as items close._
