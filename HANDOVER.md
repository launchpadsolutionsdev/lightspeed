# Handover Notes

Torin writing. This is what I'd want to know if I were on your side of the desk picking up a codebase. Not comprehensive — just what's bit me, what I'd break if I forgot it, and what's still rough.

## The stack

Node 22 + Express 4 on Render Web. Vanilla JS (no build step) on Render Static. Managed Postgres on Render. External services: Anthropic (raw fetch, no SDK), Voyage AI for KB embeddings, Stripe, Shopify Admin API, Google + Microsoft OAuth, Gmail SMTP.

Entry point is `backend/src/index.js`. Read it first. It's the map — CORS, auth middleware, every mounted router, all the `setInterval` scheduled jobs, and the migration runner that runs on every boot.

Frontend is one ~20k-line `index.html` + ~24k-line `app.js`. Marketing site and logged-in app are both in there with view switching in JS. Started that way when the app was small and never got split out.

## Tenancy

Organizations are the tenant. Users are global — one `users` row per real human, joined to orgs through `organization_memberships` with a role (owner/admin/member). Auth middleware at `src/middleware/auth.js` sets `req.organizationId` from the `X-Organization-Id` header, falling back to the caller's first membership. Every business route is supposed to filter by `req.organizationId`.

`users.is_super_admin` is a platform-operator flag, not a customer role. Grant via the `SUPER_ADMINS` env var (see below).

Schema gotchas I've hit:
- `feedback`, `audit_logs`, and `usage_logs` have nullable `organization_id` with `ON DELETE SET NULL`. Orphaned rows persist after org deletion. Every query on those tables needs an org filter or it aggregates across tenants.
- `home_base_posts.organization_id` is nullable because we wanted "global" posts. Code checks an `is_global` flag. Works, but fragile — a new query that forgets the flag leaks across orgs.

## What I fixed right before handover

This is the batch at the end of the commit log. Context for review, not a sales pitch.

- Usage-limit middleware was bypassed with an early `return next()`. Re-enabled, test unskipped.
- Invite-accept route wasn't checking the invitee email against the caller. Added that check — anyone with a token could have joined.
- `/api/feedback` super-admin view returned every org's feedback by default. Defaulted to the caller's org; `?scope=all` for the old behavior.
- Feed dashboard URL proxy was SSRF-able. Any org admin could point it at `169.254.169.254` or a private IP. Added `services/urlValidator.js`, applied on both save and fetch.
- Shopify OAuth access tokens were plaintext in the DB. Now AES-256-GCM via `services/encryption.js`. Requires `ENCRYPTION_KEY`. Legacy plaintext rows still decrypt (passthrough) and upgrade lazily on next save.
- Migration 061 hardcoded a specific Gmail as super-admin. Replaced with the `SUPER_ADMINS` env var.
- Migrations 005, 006, 009 had TBRHSF-specific seed data inline. Extracted to `backend/data/tbrhsf-seed.json`, loaded at startup when `SEED_TBRHSF=true`. The generalized product ships with no TBRHSF content.
- Two pairs of migrations had colliding filename prefixes (`049_*.sql` × 2, `052_*.sql` × 2). Renamed with `a`/`b` suffixes.
- `@anthropic-ai/sdk` was in `package.json` but never imported. Removed.

All 452 tests pass across 27 suites.

## Env vars you'll need

Beyond the obvious ones (DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID, FRONTEND_URL, NODE_ENV):

`ENCRYPTION_KEY` — 32 bytes, base64 or hex. Generate with `openssl rand -base64 32`. Treat as permanent. Lose it and every Shopify token in the DB is unreadable and every store has to reconnect.

`SUPER_ADMINS` — comma-separated emails to get `is_super_admin` on every boot. Additive only, never demotes.

`SEED_TBRHSF=true` — on our instance this keeps the TBRHSF profile / content config / KB entries refreshed from the seed JSON. Leave it unset for the generalized product.

Microsoft OAuth: both `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` must be set or the app won't boot. MSAL's `ConfidentialClientApplication` constructor validates credentials eagerly — empty strings throw at import time, not call time.

Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`.

Shopify: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`.

`VOYAGE_API_KEY` for Voyage embeddings.

SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`, `FROM_NAME`, `CONTACT_EMAIL`.

`BACKEND_URL`, `DASHBOARD_FEED_URL`.

`render.yaml` doesn't list all of these. The live service is configured via the Render dashboard. There's some drift between the two — pick one source of truth if you care about IaC.

## Scheduled jobs

`src/index.js` kicks off five `setInterval` tasks when the web process boots: calendar reminders (60s), Home Base scheduled posts (60s), digest emails (1h), Shopify analytics sync (15m), data retention cleanup (24h). No distributed locking.

If you scale the web tier past one instance you get duplicate emails, duplicate scheduled posts, duplicate Shopify API calls. The right fix is a dedicated worker service + queue (BullMQ + Redis would work). Until that happens, keep web at 1 instance.

## Migrations

65 `.sql` files in `backend/migrations/`, run in filename order on every boot. No version table — each migration self-guards with a `_migration_flags` row inside a `DO $$ BEGIN ... END $$` block. Most are idempotent.

A few things to watch:
- Migration 004 is a one-time destructive reset of orgs and memberships, protected by a flag row. Preserve that flag across DB restores or it'll wipe on next boot.
- Migrations 005, 006, 009, and 061 are no-op placeholders now. Their data moved to runtime. Don't delete them — the filename sequence matters.
- Idempotency isn't enforced by a lint — enforcement is "the author remembered." If you add migrations, use `IF NOT EXISTS`, or a `_migration_flags` guard, or `ON CONFLICT DO NOTHING`.

## What's still dirty

Stuff I didn't get to. Nothing is on fire.

Security / correctness:
- Contact form is unauthenticated. Invite and password-reset endpoints only have the global IP rate limit — enumerable.
- File uploads (PDF / DOCX / XLSX) aren't AV-scanned.
- Shopify OAuth callback verifies HMAC but doesn't check the `nonce` is single-use.

Code shape:
- `routes/homeBase.js` is ~2,300 lines. `routes/askLightspeed.js` is ~1,900. `services/shopifyAnalytics.js` is ~1,950. All three mix HTTP handling, DB queries, and transformation. Home Base is the worst because of module-global caches like `_globalColumnChecked`.
- `systemPromptBuilder.js`, `draftPromptBuilder.js`, `compliancePromptBuilder.js` overlap a lot. Probably one shared builder with thin wrappers if you want to clean it up.
- Error response shapes are inconsistent — sometimes `{ error }`, sometimes `{ code, message }`.
- A few empty `catch` blocks in `askLightspeed.js` (around lines 777, 1239, 1252). Worth auditing — these were "fail quietly and log" that drifted into "fail quietly and don't log."

Schema:
- Missing indexes on some FK columns: `knowledge_base.created_by`, `home_base_posts.author_id`, probably others. Hasn't hurt at our scale but will at yours.
- `compliance_conversations` / `compliance_messages` have `org_id` / `user_id` columns without FK constraints. Orphans possible.
- The nullable-org-id tables (`feedback`, `audit_logs`, `usage_logs`) should probably be NOT NULL with ON DELETE CASCADE.

Frontend:
- MSAL is vendored as a minified bundle (`frontend/msal-browser.min.js`, v2.38.3). Replace with an npm install + SRI.
- SheetJS, Chart.js, html2pdf load from CDNs without `integrity` attributes.
- JWT is in `localStorage`. XSS leaks the session. Moving to httpOnly cookies is a bigger change because the backend doesn't expose a cookie-based session path yet.
- Backend URL hardcoded in `app.js:124`. Move to build-time config before you rebrand or stand up multi-env.
- The Google OAuth client ID in `app.js:490` looks like a leaked secret but isn't. OAuth client IDs for browser clients are public by design. The *client secret* is server-side where it belongs.

Tests:
- ~49% of route files have a test. Big untested ones: `tools.js`, `responseHistory.js`, `contentCalendar.js`, `feedDashboard.js`, `conversations.js`. No cross-tenant isolation test — worth adding one, it's cheap and pays rent forever.
- CI allows up to 25 lint warnings. Should be 0.

Content / licensing:
- `OntarioPDF-FIles/` (yes, the typo is the directory name) holds AGCO Lottery Licensing Policy Manual content we used to seed the compliance KB. Ontario OGL applies — attribution required for republication. Confirm that lands cleanly with whatever you roll into your commercial offering.

## Service transfers

Each of these is in TBRHSF / Launchpad Solutions names and needs moving:

Render (web service, static site, Postgres, custom domain `lightspeedutility.ca`) — team transfer is supported, but the Postgres is tied to the service, so you may need a dump/restore across workspaces.

Stripe — entity-bound. Customer and subscription migration isn't automatic. A Stripe support ticket is likely.

Shopify Partner app — transfer needs Shopify approval. Merchants may have to reinstall.

Google OAuth (consent screen, client ID, redirect URIs) — users may need to re-consent; app verification may need re-submission.

Microsoft Azure AD app — similar.

Anthropic and Voyage API keys — easy, issue new keys under your workspace.

Gmail SMTP — swap credentials. Worth the move to Postmark or SendGrid for prod while you're in there.

GitHub repo — standard transfer.

DNS for `lightspeedutility.ca` — update nameservers / registrar.

## If you're new to the code

Order I'd read in:

1. `backend/src/index.js` cover to cover.
2. `backend/src/middleware/auth.js`.
3. Pick a small route file (`routes/favorites.js` or `routes/responseHistory.js`) and trace one request end-to-end from `frontend/app.js` to Postgres and back.
4. Migrations in filename order. It's the real schema history.
5. `cd backend && npm ci && npm test`.
6. Hit `/health` on the running service.

Files I'd avoid touching in the first week: `homeBase.js`, `askLightspeed.js`, `shopifyAnalytics.js`, the migration runner in `index.js`, the scheduled-job block at the bottom of `index.js`.

## Questions

Reach me at whatever contact we set up. This doc will go stale fast — update it as things close.

— Torin
