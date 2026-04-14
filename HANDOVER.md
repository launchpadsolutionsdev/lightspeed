# Lightspeed — Engineering Handover

This document is written for the engineering team receiving the Lightspeed codebase. It is deliberately frank about known limitations, technical debt, and transfer considerations. The goal is to give you a realistic starting point rather than a polished pitch.

Companion docs:
- `README.md` — user-facing overview and setup
- `DEPLOYMENT.md` — infrastructure reference
- `LICENSE` — MIT

---

## 1. What Lightspeed is (and isn't)

**Is:** an AI-assisted productivity SaaS for hospital foundations and charitable-gaming organizations running lotteries. Staff paste inquiries or data, the app drafts responses, analyzes sales, and automates calendars/content.

**Isn't:** a fully horizontally-scaled platform. See §5 on scale limits. It runs today on a single Render web instance with Postgres, and the architecture assumes that.

**Scale reference point (at time of handover):** small number of customer organizations, single-digit concurrent users, single production instance.

---

## 2. Architecture at a glance

```
┌───────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (static site)   │───────▶│  Backend (Node.js / Express) │
│  Vanilla JS, no build     │  HTTPS │  /api/*                      │
│  Render Static            │        │  Render Web Service          │
└───────────────────────────┘        └──────┬───────────────────────┘
                                            │
                                ┌───────────┼─────────────┬──────────────┐
                                ▼           ▼             ▼              ▼
                         Postgres    Anthropic API   Stripe / Shopify  Gmail SMTP
                         (Render)    Voyage AI       Google / MSFT OAuth
```

- **Frontend:** static vanilla JS + HTML + CSS. No bundler, no framework. `frontend/index.html` is a ~20k-line single page combining the marketing site and the app UI.
- **Backend:** Node.js 22 + Express 4. Entry point `backend/src/index.js`. Routes mounted under `/api/*`.
- **Database:** managed Postgres on Render. 65 SQL migrations in `backend/migrations/` run on every app startup.
- **Scheduled work:** in-process `setInterval` tasks in `backend/src/index.js:206-247`. **Single-instance assumption — do not scale to >1 web instance without changing this.**
- **AI:** Anthropic Claude for generation, Voyage AI for embeddings (semantic KB search).

---

## 3. Repository layout

```
/backend
  /src
    index.js            ← app entry, router mounting, scheduled jobs, migration runner
    /routes             ← Express routers, one per domain
    /services           ← shared services (logger, email, Shopify, AI helpers)
    /middleware         ← auth, rate limiting, org resolution
  /migrations           ← 65 .sql files, run in filename order on startup
  /config/database.js   ← pg Pool
  /__tests__            ← Jest integration tests (partial coverage)
  /data                 ← compliance KB seed JSON (Ontario AGCO-derived content)
  /scripts              ← one-off operational scripts

/frontend
  index.html            ← marketing site + SPA app (single file, ~20k lines)
  app.js                ← client app logic (~24k lines)
  /whats-new, /help, /pricing, ... ← marketing subpages
  /logos                ← customer/client logos
  msal-browser.min.js   ← vendored Microsoft MSAL (see §6)

render.yaml             ← Blueprint config (out-of-sync with dashboard, see §7)
OntarioPDF-FIles/       ← source PDFs for the compliance KB
```

---

## 4. Multi-tenant model

- The unit of tenancy is `organizations`. Most business tables carry `organization_id`.
- Users are **global** (one row in `users` per real human), joined to orgs via `organization_memberships` with a role (`owner`/`admin`/`member`).
- The auth middleware at `backend/src/middleware/auth.js` resolves `req.organizationId` from the `X-Organization-Id` request header, falling back to the user's first membership.
- Every business route is expected to filter by `req.organizationId`. Most do; a handful of known exceptions are called out in §8.

**Known gaps:**
- `users` has no `organization_id` (by design, since users can belong to multiple orgs), which means any admin endpoint that returns user data must be careful.
- `feedback`, `audit_logs`, and `usage_logs` have **nullable** `organization_id` with `ON DELETE SET NULL`. Orphaned rows persist after org deletion and any unfiltered query aggregates across tenants.
- `home_base_posts.organization_id` is nullable to support "global" (all-orgs) content; code branches on an `is_global` flag. Fragile — one missing branch in a new query leaks content across orgs.

---

## 5. Operational considerations

### Deployment
- Render auto-deploys `main` to the `lightspeed-api` and `lightspeed-frontend` services.
- Migrations auto-run on every backend startup. They use `IF NOT EXISTS` patterns and a `_migration_flags` tracking table, but **coverage is inconsistent** — not every migration is hardened against re-run. A clean stand-up on a fresh Postgres should work but spot-check.
- There are **two pairs of migrations with colliding filename prefixes** (`049_*.sql` × 2, `052_*.sql` × 2). `fs.readdirSync().sort()` picks an undefined winner — fresh environments may end up with subtly different schemas than production. Resolve before cloning to a new environment.
- Migration `004_reset_organization_memberships.sql` is a **one-time destructive reset** (deletes all orgs/memberships) gated by a flag. Protect the flag row if you ever restore from a snapshot.

### Scheduled jobs (single-instance assumption)
`backend/src/index.js` schedules five in-process jobs:

| Job | Interval | Notes |
|-----|----------|-------|
| Calendar reminder checker | 60 s | sends email reminders |
| Home Base scheduled post publisher | 60 s | publishes scheduled posts |
| Home Base digest emails | 1 h | weekly/daily digest |
| Shopify analytics sync | 15 min | per-store incremental sync, guarded by a process-local flag |
| Data retention cleanup | 24 h | purges per retention policy |

None of these have distributed locking. **Scaling the web tier to >1 instance will cause duplicate emails, duplicate post publishes, and duplicate Shopify API calls.** The right fix is a dedicated worker + queue (BullMQ + Redis is a small lift); the interim fix is to keep the web tier at 1 instance.

### Observability
- JSON logs to stdout via `backend/src/services/logger.js`.
- `GET /health` checks database + Anthropic reachability; `503` if either is down.
- No APM, no error-tracking service (Sentry/Rollbar). Log-based investigation only.

---

## 6. Frontend peculiarities

- **No build step.** Vanilla JS/HTML/CSS served as static files. Changes require a hard refresh but no compilation.
- **Single HTML file (`frontend/index.html`) contains both the marketing site and the logged-in SPA.** View switching is handled in `app.js`. This was convenient early on; a future rewrite should split them and introduce a bundler.
- **Backend URL is hardcoded** in `frontend/app.js:124` (`https://lightspeed-backend.onrender.com`). Rebranding or repointing requires a code change.
- **Google OAuth client ID is in source** (`app.js:490`). This is expected — OAuth client IDs for browser clients are public by design. It is *not* a secret. The Google *client secret*, and the Microsoft *client secret*, live server-side.
- **Auth token in localStorage.** JWT stored in `localStorage` for API requests. XSS would leak the session. Mitigation would require server-side cookie support which the backend does not currently expose.
- **Vendored MSAL.** `frontend/msal-browser.min.js` (v2.38.3, ~376KB) is checked in as a minified bundle. Replacing with an npm-installed module + SRI hash is recommended.
- **CDN assets (SheetJS, Chart.js, html2pdf)** are loaded without Subresource Integrity. Add `integrity` attributes.

---

## 7. Infrastructure quirks

- `render.yaml` at repo root exists but the live `lightspeed-api` service is **configured via the Render dashboard, not the blueprint**. Changing `render.yaml` alone will not affect production. If you want IaC-managed infra, the service needs to be recreated from the blueprint (careful: the managed Postgres is tied to the service).
- Not all env vars used by the code are declared in `render.yaml`. The following are set directly in the dashboard: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `VOYAGE_API_KEY`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SMTP_HOST/PORT/USER/PASS`, `FROM_EMAIL`, `FROM_NAME`, `CONTACT_EMAIL`, `BACKEND_URL`, `DASHBOARD_FEED_URL`.
- Node version is pinned implicitly to Render's default (22.22.0 at time of writing). `backend/package.json` should declare `"engines"` to lock this.

---

## 8. Known issues / debt backlog

The list below is the honest inventory. Severity reflects impact on a new operator; none of these are immediate outages.

### Security / correctness
| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | Usage-limit middleware bypassed with a `return next()` marked "TEMPORARY" | `backend/src/middleware/auth.js:173-176` | High — plan enforcement disabled |
| 2 | Invite-accept endpoint does not verify the invitee email matches the caller | `backend/src/routes/organizations.js:330-391` | High — lateral movement risk |
| 3 | Feed-dashboard URL proxy fetches arbitrary user-supplied URLs server-side (SSRF) | `backend/src/routes/feedDashboard.js:153-174` | High |
| 4 | Feedback list endpoint returns rows across all orgs | `backend/src/routes/feedback.js:63` | High — cross-tenant data exposure to super-admin |
| 5 | Shopify OAuth access tokens stored plaintext in `shopify_stores.access_token` | migration `019_*`, service `backend/src/services/shopifyStore.js` | High — breach amplifies blast radius |
| 6 | `@anthropic-ai/sdk@^0.17.1` is multiple major versions behind | `backend/package.json` | Medium — blocks newer features (prompt caching, etc.) |
| 7 | Test coverage ~49% by file; no isolation tests; `usageLimit.test.js` is `describe.skip` | `backend/__tests__/` | Medium |
| 8 | Contact form unauthenticated; password-reset/invite endpoints rely on global IP rate limit only | `backend/src/routes/contact.js:22`, `auth.js` | Low–Medium |
| 9 | Uploaded PDFs/DOCX/XLSX parsed without AV scan | `backend/src/routes/askLightspeed.js`, `knowledgeBase.js` | Low |
| 10 | Stripe webhook signature verified; Shopify webhook/HMAC verified on install but nonce not validated single-use | `backend/src/routes/shopify.js` | Low–Medium |

### Architecture / maintainability
| # | Issue | Location |
|---|-------|----------|
| 11 | Monolithic route files doing HTTP + DB + transformation in one place | `homeBase.js` (~2.3k lines), `askLightspeed.js` (~1.9k), `compliance.js`, `shopifyAnalytics.js` (~1.9k) |
| 12 | Single-file frontend (`index.html` ~20k lines; `app.js` ~24k lines) |  |
| 13 | Business logic duplicated across `systemPromptBuilder.js`, `draftPromptBuilder.js`, `compliancePromptBuilder.js` |  |
| 14 | Magic numbers for intervals/limits scattered inline | `index.js` scheduler, various routes |
| 15 | Error response shapes inconsistent across routes (some `{ error }`, some `{ code, message }`) |  |
| 16 | Silent-catch blocks that swallow errors | `askLightspeed.js:777, 1239, 1252` |

### Schema
| # | Issue | Location |
|---|-------|----------|
| 17 | Duplicate migration prefixes (`049_*.sql`×2, `052_*.sql`×2) | `backend/migrations/` |
| 18 | Missing indexes on several foreign-key columns (e.g., `knowledge_base.created_by`, `home_base_posts.author_id`) |  |
| 19 | `compliance_conversations` / `compliance_messages` missing FK constraints | migration `047_*` |
| 20 | `feedback` / `audit_logs` / `usage_logs` use `organization_id UUID ... ON DELETE SET NULL` (should likely be `NOT NULL ... ON DELETE CASCADE`) |  |

### Data
| # | Issue |
|---|-------|
| 21 | `backend/migrations/005_seed_thunderbay_knowledge_base.sql` (and adjacent seed migrations) contain identifying operational data for a real customer organization. Transfer was disclosed and consented to by that customer at handover. |
| 22 | `backend/migrations/061_add_superadmin_mannis.sql` hardcodes a single Gmail address as super-admin. Rotate on acceptance. |
| 23 | `OntarioPDF-FIles/` contains the Ontario AGCO Lottery Licensing Policy Manual, used to build the compliance KB. AGCO content is subject to Ontario's Open Government License; attribution is required for republication. Confirm your redistribution is compatible with the applicable license terms. |

---

## 9. External services — transfer considerations

Each of the integrations below is tied to an account owned by the selling entity and will need to be transferred or re-registered.

| Service | What to transfer | Complexity |
|---------|------------------|------------|
| **Render** | Web service, static site, managed Postgres, env vars, custom domain (`lightspeedutility.ca`) | Medium — Render supports team transfers, but Postgres may need dump/restore if crossing organizations |
| **Stripe** | Account, products, prices, webhook endpoint, active subscriptions | High — Stripe accounts are entity-bound. Customer + subscription migration is non-trivial and may involve Stripe support |
| **Shopify Partner** | OAuth app (API key/secret), webhook subscriptions, any public app listing | High — app transfer requires Shopify approval; merchants may need to reinstall |
| **Anthropic** | API key | Low — issue new key under the acquirer's workspace |
| **Voyage AI** | API key | Low |
| **Google Cloud / OAuth** | OAuth consent screen, client ID, authorized redirect URIs | Medium — users may need to re-consent; app verification may need re-submission |
| **Microsoft / Azure AD** | App registration, client ID, client secret | Medium — similar to Google |
| **Gmail SMTP** | Sending account + App Password (currently used for transactional email) | Low — swap credentials; consider migrating to Postmark/SendGrid for production |
| **GitHub** | Repository ownership, branch protections, secrets, Actions config | Low — standard repo transfer |
| **DNS / Cloudflare / registrar** | Domain `lightspeedutility.ca` and any subdomains | Medium — update nameservers / registrar account |

A more detailed transition checklist should be maintained by the acquiring side's integration lead.

---

## 10. Getting started as a new engineer

If you are joining the codebase, in this order:

1. **Read `backend/src/index.js`** end-to-end. It's the map: CORS, auth, rate limits, every mounted router, every `setInterval`, the migration runner.
2. **Read `backend/src/middleware/auth.js`**. Understand how `req.user` and `req.organizationId` are set — every route relies on them.
3. **Pick one route file** (e.g. `backend/src/routes/responseHistory.js`) and trace one request from browser (`frontend/app.js`) → network → Express → Postgres → response.
4. **Read `backend/migrations/` in filename order**. It's the authoritative schema history. Watch for the collision pairs noted above.
5. **Run the tests**: `cd backend && npm ci && npm test`. They're Jest integration tests; they assume a test Postgres (check `__tests__/setup.js`).
6. **Hit `/health`** in production or a staging environment to confirm service connectivity.

Places to **avoid making first changes:**
- `homeBase.js`, `askLightspeed.js`, `shopifyAnalytics.js` — large files with subtle state. Read, don't edit, until you've been in the code for a week.
- The migration runner and the `_migration_flags` table — small changes can brick fresh environments.
- The scheduled jobs in `index.js` — easy to create duplicate email storms.

---

## 11. Suggested 90-day roadmap

Opinionated. The acquirer will have their own priorities — this is just what the existing team would prioritize given free hands.

**First 30 days**
- Close items 1–5 from §8 (security/correctness hot list)
- Rename colliding migrations (#17) and add a migration lint check
- Pin Node version in `package.json`
- Reconcile `render.yaml` with dashboard settings
- Adopt Sentry (or equivalent) for error tracking

**30–60 days**
- Upgrade `@anthropic-ai/sdk` and enable prompt caching on system prompts (measurable cost reduction)
- Extract scheduled jobs into a separate worker process (even a second Render service on the same code)
- Break `homeBase.js` and `askLightspeed.js` into sub-routers + service modules
- Add cross-tenant isolation tests (one solid test pays rent forever)

**60–90 days**
- Split `frontend/index.html` marketing vs. app; introduce a bundler (Vite) for the app half
- Migrate Shopify access tokens to encrypted storage
- Replace hardcoded backend URL in frontend with build-time config
- Add OpenAPI generation from routes (any lightweight middleware works)

---

## 12. Contact

For questions during transition, reach the outgoing engineering contact through the channels established in the transition plan. This document should be kept up-to-date as items are closed.

_Last updated at handover._
