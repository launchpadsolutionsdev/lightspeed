# Lightspeed Codebase Audit

**Prepared for:** Launchpad Solutions
**Date:** February 9, 2026
**Scope:** Full codebase audit of the Lightspeed AI-powered SaaS platform for charitable lottery operations

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Code Quality Issues](#2-code-quality-issues)
3. [Performance & Scalability](#3-performance--scalability)
4. [Security Audit](#4-security-audit)
5. [UX/UI Improvements](#5-uxui-improvements)
6. [Feature Recommendations](#6-feature-recommendations)
7. [DevOps & Deployment](#7-devops--deployment)

---

## 1. Architecture Overview

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3 — single-page application |
| **Backend** | Node.js + Express.js |
| **Database** | PostgreSQL (via `pg` connection pool) |
| **AI/LLM** | Anthropic Claude API (direct HTTP calls) |
| **Auth** | Google OAuth 2.0 → JWT (7-day expiry) |
| **Payments** | Stripe (Checkout + Customer Portal + Webhooks) |
| **Email** | Nodemailer over Gmail SMTP |
| **Hosting** | Render.com (free tier) — backend web service + static frontend + managed Postgres |

### Folder Structure

```
lightspeed/
├── backend/
│   ├── config/database.js          # PostgreSQL connection pool
│   ├── src/
│   │   ├── index.js                # Express entry point, middleware, migration runner
│   │   ├── middleware/auth.js      # JWT verification, RBAC (5 middleware functions)
│   │   ├── routes/                 # 11 route files
│   │   │   ├── admin.js            # Super admin dashboard (9 endpoints)
│   │   │   ├── auth.js             # Google OAuth login/signup (3 endpoints)
│   │   │   ├── billing.js          # Stripe integration (4 endpoints)
│   │   │   ├── contact.js          # Contact form (1 endpoint)
│   │   │   ├── drawSchedules.js    # Draw schedule CRUD + AI parsing (5 endpoints)
│   │   │   ├── favorites.js        # Saved responses (3 endpoints)
│   │   │   ├── feedback.js         # User feedback (2 endpoints)
│   │   │   ├── knowledgeBase.js    # Knowledge CRUD + doc upload (8 endpoints)
│   │   │   ├── organizations.js    # Team mgmt + invites (8 endpoints)
│   │   │   ├── responseHistory.js  # Response tracking + ratings (5 endpoints)
│   │   │   └── tools.js            # AI tools: generate, analyze, normalize, draft (5 endpoints)
│   │   └── services/
│   │       ├── claude.js           # Anthropic API wrapper
│   │       └── email.js            # SMTP email service
│   └── migrations/                 # 8 SQL migration files (001–008)
├── frontend/
│   ├── index.html                  # 11,795-line monolithic SPA container
│   ├── app.js                      # 9,773-line main application logic
│   ├── admin-dashboard.js          # 1,009-line admin panel
│   ├── knowledge-base.js           # Hardcoded FAQ templates (1,153 lines)
│   ├── draft-knowledge-base.js     # Draft content examples (645 lines)
│   ├── draw-schedule.js            # Hardcoded draw schedule (211 lines)
│   ├── design-system.css           # Design tokens (189 lines)
│   ├── landing.css                 # Landing page styles (2,494 lines)
│   ├── admin-dashboard.css         # Admin styles (1,081 lines)
│   ├── case-study.html/css         # Case study page
│   └── logos/                      # Brand images
└── render.yaml                     # Deployment blueprint
```

### Entry Points & Routing

- **Backend:** `backend/src/index.js` — Express server on port 3001, runs all SQL migrations on startup, then starts listening
- **Frontend:** `frontend/index.html` — loads all CSS/JS, contains all HTML views inline. `app.js` implements a client-side router with `history.pushState` (see `ROUTES` object at `app.js:9581`)
- **API prefix:** All API routes are under `/api/` with JWT Bearer token authentication

### Database Schema (10 tables)

`users`, `organizations`, `organization_memberships`, `organization_invitations`, `usage_logs`, `knowledge_base`, `response_templates`, `response_history`, `favorites`, `feedback`, `draw_schedules`, plus a `_migration_flags` helper table.

### Third-Party Integrations

| Integration | Purpose | Files |
|------------|---------|-------|
| **Google OAuth 2.0** | User authentication | `auth.js:15`, `app.js:244` |
| **Anthropic Claude API** | AI response generation | `services/claude.js`, `routes/tools.js` |
| **Stripe** | Subscription billing | `routes/billing.js:11–17` |
| **Gmail SMTP** | Transactional emails (invites, contact form) | `services/email.js` |
| **SheetJS** | Client-side Excel parsing | `index.html:15` (CDN) |
| **Chart.js** | Data visualization | `index.html:17` (CDN) |
| **html2pdf** | PDF export | `index.html:19` (CDN) |

### Multi-Tenancy Assessment

The current architecture uses a **single-org-per-user** model with `organization_id` as the tenant key on most tables. This is a solid foundation for multi-tenancy, but there are gaps:

- **Strengths:** Organization-scoped data via `organization_id` foreign keys; middleware (`requireOrganization`) enforces org membership; knowledge base, draw schedules, response history, and favorites are all org-scoped.
- **Gaps:** The frontend hardcodes Thunder Bay 50/50 knowledge (`knowledge-base.js`), draw schedules (`draw-schedule.js`), and brand examples (`draft-knowledge-base.js`) — these would bleed into every client's experience. Organization lookup is repeated in nearly every route handler instead of being centralized. No per-org feature flags or plan-based limits are enforced server-side (the 500-generation Starter cap is only mentioned in frontend pricing copy).

---

## 2. Code Quality Issues

### CRITICAL

**C1. 9,773-line monolithic `app.js`** (`frontend/app.js`)
The entire frontend application logic — auth, routing, all 5+ tools, data analysis dashboards, UI rendering, state management — lives in a single file. This is the single biggest maintainability risk in the codebase. It makes debugging, testing, and onboarding difficult.
*Recommendation:* Split into modules by feature area (auth, router, response-assistant, insights-engine, list-normalizer, draft-assistant, ask-lightspeed, shared utilities). Consider adopting a lightweight bundler (Vite) or at minimum ES modules with `<script type="module">`.

**C2. 11,795-line monolithic `index.html`** (`frontend/index.html`)
All HTML for every view/page — landing page, auth, all tools, settings, Terms of Service, Privacy Policy, legal modals — is in a single file with extensive inline CSS (roughly 4,000+ lines of `<style>` blocks). Combined with `app.js`, this means two files totaling ~21,500 lines carry the entire frontend.
*Recommendation:* Extract inline styles into the existing CSS files. Consider templating or component-based rendering.

**C3. Google Client ID hardcoded in frontend** (`app.js:244`)
```js
const GOOGLE_CLIENT_ID = '538611064946-ij0geilde0q1tq0hlpjep886holcmro5.apps.googleusercontent.com';
```
While Google Client IDs are considered semi-public, hardcoding them makes rotation difficult and mixes configuration with code.
*Recommendation:* Inject via a build step or a `/config` API endpoint.

### HIGH

**H1. Duplicated organization lookup pattern** (every route file)
Nearly every authenticated route handler repeats this exact pattern:
```js
const orgResult = await pool.query(
    'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
    [req.userId]
);
if (orgResult.rows.length === 0) {
    return res.status(400).json({ error: 'No organization found' });
}
const organizationId = orgResult.rows[0].organization_id;
```
This appears in `tools.js` (4 times), `knowledgeBase.js` (8 times), `responseHistory.js` (5 times), `favorites.js` (2 times), `feedback.js` (1 time), `drawSchedules.js` (5 times).
*Recommendation:* Create a middleware `attachOrganization` that runs after `authenticate` and adds `req.organizationId` and `req.organization` to the request. This would eliminate ~25 duplicate code blocks.

**H2. Hard-coded values that should be environment variables**

| Value | File:Line | Issue |
|-------|-----------|-------|
| `FRONTEND_URL = 'https://www.lightspeedutility.ca'` | `organizations.js:14` | Should use `process.env.FRONTEND_URL` |
| `CONTACT_EMAIL = 'torin@launchpadsolutions.ca'` | `contact.js:10` | Should be env var |
| Stripe Price IDs | `billing.js:14–17` | Should be env vars for test/prod flexibility |
| `API_BASE_URL` production URL | `app.js:13–14` | Hard-coded backend URL |
| `GOOGLE_CLIENT_ID` | `app.js:244` | Hard-coded in frontend |
| Cost estimation rates ($3/$15 per 1M tokens) | `admin.js:521–523` | Will break when pricing changes |
| `avgResponseTimeMs = 245`, `successRate = 98` | `admin.js:59–60` | Fake metrics displayed as real data |

**H3. Duplicated multer configuration** (`knowledgeBase.js:16–27`, `drawSchedules.js:17–30`)
Both files create identical multer upload configurations. Should be extracted to a shared middleware module.

**H4. Inconsistent API response format for the `/api/generate` route**
The `tools.js:17` `/generate` endpoint returns the raw Claude API response directly (`res.json(response)`), which exposes internal API structure to the frontend. The `/analyze`, `/normalize`, and `/draft` endpoints do the same. This couples the frontend tightly to the Anthropic response format.
*Recommendation:* Normalize all AI responses into a consistent shape like `{ content: string, usage: { tokens: number } }`.

### MEDIUM

**M1. Dual mounting of tools routes** (`index.js:85–86`)
```js
app.use('/api/tools', toolsRoutes);
app.use('/api', toolsRoutes); // Also mount at /api for /api/generate endpoint
```
This mounts every tool route under both `/api/tools/*` and `/api/*`, meaning `/api/generate` AND `/api/tools/generate` both work. This creates unnecessary route ambiguity.
*Recommendation:* Pick one mount point and update the frontend to match.

**M2. `draw-schedule.js` hardcodes Thunder Bay 50/50 data**
The file contains literal February 2026 draw schedule data for a specific client. Once another nonprofit onboards, they'll see Thunder Bay's schedule.
*Recommendation:* This is now partially solved by the database-backed draw schedule system, but the frontend fallback still loads the hardcoded file for all users.

**M3. `knowledge-base.js` is client-specific despite comments claiming it's generic**
The file header says "organization-agnostic" but many responses reference Ontario-specific AGCO regulations, specific lottery types (50/50, Catch the Ace), and assume a specific operational model. While useful as seed data, it ships to every frontend.

**M4. Missing input validation on AI tool endpoints**
The `/api/generate` endpoint accepts arbitrary `messages` and `system` prompt from the client with minimal validation (`tools.js:20–23`). The `max_tokens` parameter is user-controlled with no upper bound check.
*Recommendation:* Cap `max_tokens` at a reasonable ceiling (e.g., 4096). Validate `messages` array structure. Sanitize `system` prompt input.

**M5. Usage logging uses different approaches**
`tools.js` queries the org membership to get `organizationId` for logging, but the pattern varies: `/generate` does a separate query, `/analyze` joins organizations to get `brand_voice` AND the org ID, `/draft` does two separate org queries (lines 295 and 337). Should be unified.

**M6. Password hash column still exists in schema** (`001_initial_schema.sql:12`)
The `users.password_hash` column is nullable and the codebase comment says "Google OAuth only - email/password removed" (`auth.js:3`), but the column remains. Dead schema should be cleaned up.

### LOW

**L1. Console.log statements throughout production code**
Both frontend and backend contain extensive `console.log` and `console.warn` calls that will appear in production. Example: `app.js:258` logs user count from localStorage.

**L2. `bcryptjs` dependency unused** (`package.json:13`)
The `bcryptjs` package is listed as a dependency but is never imported or used anywhere in the codebase (email/password auth was removed). Should be removed to reduce attack surface.

**L3. `response_templates` table unused**
Migration `001_initial_schema.sql:86–96` creates a `response_templates` table, but no route or code references it. Either implement the feature or remove the table.

**L4. Frontend uses `localStorage` for user data alongside backend API**
`app.js` maintains a `users` array in localStorage (line 251–260) alongside backend-authenticated user data. This creates a dual source of truth and potential for stale data.

**L5. Error messages expose internal details**
Several routes return `error.message` to the client (e.g., `tools.js:54`, `tools.js:154`), which can leak internal system information.

---

## 3. Performance & Scalability

### CRITICAL

**P1. All migrations run on every server start** (`index.js:109–126`)
Every time the server boots, it reads all `.sql` files in the migrations directory and executes them sequentially. While most use `IF NOT EXISTS` guards, migration `004_reset_organization_memberships.sql` contains destructive operations (DELETE all orgs) guarded only by a flag table check. If the `_migration_flags` table is ever dropped or corrupted, all organization data would be deleted.
*Recommendation:* Use a proper migration runner (e.g., `node-pg-migrate` or `knex`) with version tracking and up/down support. Never run migrations automatically in production.

**P2. No usage/generation limits enforced server-side**
The pricing page mentions "500 AI generations/month" for the Starter tier, but no backend code enforces this. The `usage_logs` table records usage but nothing checks against a cap. Any user on any plan can make unlimited API calls.
*Recommendation:* Add middleware that checks `usage_logs` count per organization per billing period before allowing AI tool calls.

### HIGH

**P3. N+1 query pattern in knowledge base import** (`knowledgeBase.js:337–355`)
The `/import` endpoint loops through entries and executes individual INSERT queries. For large imports, this creates N separate database round-trips.
*Recommendation:* Use a single bulk INSERT statement or batch the queries.

**P4. No database connection pooling configuration** (`config/database.js`)
The `Pool` is created with only `connectionString` — no `max`, `min`, `idleTimeoutMillis`, or `connectionTimeoutMillis` settings. On the Render free tier (limited connections), this could cause connection exhaustion.
*Recommendation:* Configure pool limits: `max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000`.

**P5. Admin dashboard fires many sequential queries** (`admin.js:15–117`)
The `/api/admin/dashboard` endpoint runs 11 separate sequential database queries. These could be combined or run in parallel with `Promise.all`.
*Recommendation:* Combine into fewer queries using CTEs or UNION, or at minimum run independent queries concurrently.

**P6. Frontend loads all JavaScript for all tools upfront**
Every user loads `knowledge-base.js` (1,153 lines of FAQ data), `draft-knowledge-base.js` (645 lines), `draw-schedule.js` (211 lines), `admin-dashboard.js` (1,009 lines), and `app.js` (9,773 lines) on every page load — even unauthenticated landing page visitors.
*Recommendation:* Lazy-load tool-specific scripts only when the tool is accessed.

### MEDIUM

**P7. No caching on any API endpoint**
The admin dashboard data, knowledge base entries, and organization settings are fetched fresh on every request. Common data like the active draw schedule, org profile, and knowledge base could be cached.
*Recommendation:* Add in-memory caching (e.g., `node-cache`) with short TTLs for read-heavy endpoints. Add `Cache-Control` headers for static data.

**P8. CDN libraries loaded from multiple origins** (`index.html:14–19`)
SheetJS, Chart.js, and html2pdf are loaded from three different CDNs (`cdn.sheetjs.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`), each requiring separate DNS lookups and TLS handshakes.
*Recommendation:* Self-host these libraries or use a single CDN origin. Pin exact versions for reproducibility.

**P9. Large JSON payloads sent to Claude API** (`tools.js:99, 126`)
The `/analyze` endpoint serializes the entire uploaded dataset as JSON and sends it in the prompt (`JSON.stringify(data, null, 2)`). For large spreadsheets, this could exceed token limits or cause timeouts.
*Recommendation:* Truncate or sample large datasets before sending to the API. Add a maximum row count.

**P10. Missing database indexes for common queries**
The `usage_logs` table is queried by `user_id` (for per-user activity) but has no index on `user_id`. Similarly, the `draw_schedules` table has indexes for org+active but not for `created_by`.
*Recommendation:* Add index: `CREATE INDEX idx_usage_logs_user ON usage_logs(user_id)`.

### LOW

**P11. `render.yaml` uses free tier** (`render.yaml:9, 49`)
The free tier on Render spins down after 15 minutes of inactivity, causing cold start delays of 30–60 seconds. The free PostgreSQL database also has storage and connection limits.
*Recommendation:* Upgrade to at least Render Starter ($7/mo) for always-on instances before onboarding paying customers.

---

## 4. Security Audit

### CRITICAL

**S1. SQL injection risk in admin analytics queries** (`admin.js:132–135, 158, 174, 397, 403, 413`)
Multiple admin queries use string interpolation for the `days` parameter:
```js
WHERE created_at > NOW() - INTERVAL '${days} days'
```
While `parseInt(days)` is used in some cases (`admin.js:403`), the engagement endpoint (`admin.js:132`) does not sanitize:
```js
const { period = 30 } = req.query;
const days = parseInt(period);
// Then used as: INTERVAL '${days} days'
```
`parseInt` mitigates the risk (it returns NaN for non-numeric strings, which would cause a SQL error rather than injection), but this pattern is fragile and could be bypassed.
*Recommendation:* Use parameterized queries: `WHERE created_at > NOW() - ($1 || ' days')::INTERVAL` or use `make_interval(days => $1)`.

**S2. Contact form has no authentication or rate limiting** (`contact.js:12`)
The `/api/contact` endpoint has no `authenticate` middleware and no per-endpoint rate limiting. It accepts `name`, `email`, and `message` without CSRF protection. This is an open target for spam/abuse.
*Recommendation:* Add CAPTCHA (Google reCAPTCHA), implement per-IP rate limiting stricter than the global 60/min, and add input length limits.

**S3. No CSRF protection**
The application uses JWT Bearer tokens (not cookies), which provides inherent CSRF resistance for API calls. However, the Google OAuth flow and Stripe webhooks should be verified for CSRF scenarios. The `cors` configuration allows requests with no `Origin` header (`index.js:45`), which could be exploited.
*Recommendation:* Tighten CORS to reject requests without an Origin header in production.

**S4. Auth fallback accepts unverified user data** (`auth.js:54–59`)
```js
} else if (email && googleId) {
    // Fallback: use provided user info
    userEmail = email;
    userName = name || '';
    userGoogleId = googleId;
    userPicture = picture || '';
}
```
If no `credential` token is provided, the endpoint accepts raw `email` and `googleId` from the request body without any verification. An attacker could create an account or login as any user by providing their email and any `googleId`.
*Recommendation:* Remove this fallback entirely. Always require and verify the Google `credential` token.

### HIGH

**S5. XSS vulnerability in contact form email** (`contact.js:41–55`)
User-supplied `name`, `title`, `organizationName`, `email`, `phone`, and `message` are interpolated directly into HTML email templates without escaping:
```js
<td style="...">${name}</td>
```
If the contact email is viewed in an HTML email client, this enables stored XSS.
*Recommendation:* HTML-encode all user inputs before embedding in email templates.

**S6. XSS vulnerability in invitation email** (`email.js:90–114`)
The `inviterName`, `organizationName`, and `inviteLink` parameters are interpolated into the HTML email template without escaping. If an attacker controls their first/last name or organization name, they can inject HTML/JS into invitation emails.
*Recommendation:* HTML-encode all dynamic values in email templates.

**S7. Stripe webhook returns 500 on processing errors** (`billing.js:122`)
If webhook processing fails (e.g., database error), the endpoint returns `500`, which causes Stripe to retry the webhook. If the error is persistent (e.g., missing organization), this creates an infinite retry loop.
*Recommendation:* Return `200` for events that are acknowledged but can't be processed, and log the error for manual review.

**S8. JWT secret could be weak**
The `render.yaml` generates JWT_SECRET with `generateValue: true`, which is good. But `JWT_EXPIRES_IN` defaults to 7 days (`auth.js:24`), which is very long for a SaaS application. There's no token revocation mechanism — if a user's access should be revoked, their JWT remains valid for up to 7 days.
*Recommendation:* Reduce JWT expiry to 1 hour with refresh tokens. Implement a token blocklist or version check.

**S9. Dependency vulnerability: `nodemailer <=7.0.10`**
`npm audit` reports a moderate severity vulnerability in nodemailer:
- GHSA-mm7p-fcc7-pg87: Email to unintended domain due to interpretation conflict
- GHSA-rcmh-qjqh-p98v: DoS via recursive addressparser calls
*Recommendation:* Upgrade to `nodemailer@8.x` (`npm audit fix --force`).

### MEDIUM

**S10. `rejectUnauthorized: false` for production SSL** (`config/database.js:10`)
```js
ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
```
This disables SSL certificate verification in production, making the database connection vulnerable to man-in-the-middle attacks.
*Recommendation:* Use `{ rejectUnauthorized: true }` with the Render-provided CA certificate, or use `sslmode=require` in the connection string.

**S11. No request body size limit on most endpoints**
While `express.json({ limit: '10mb' })` is set globally (`index.js:64`), 10MB is very generous for API payloads. The knowledge base import and data analysis endpoints could receive very large payloads.
*Recommendation:* Reduce global limit to 1MB and set higher limits only on specific endpoints that need it.

**S12. Admin endpoints vulnerable to timing-based enumeration**
The admin user list endpoint (`admin.js:276`) returns user emails, names, and organization data. While protected by `requireSuperAdmin`, there's no audit logging for who accessed this sensitive data.
*Recommendation:* Add audit logging for all admin data access.

### LOW

**S13. `.gitignore` is minimal**
Only ignores `node_modules/`, `.env`, and `.DS_Store`. Missing: `*.log`, `coverage/`, `dist/`, `.env.*`, `*.pem`, `.vscode/`, `.idea/`.

**S14. No Content-Security-Policy headers**
While `helmet` is used, the default helmet configuration doesn't set a strict CSP. The frontend loads scripts from 4 external domains.
*Recommendation:* Configure a CSP that whitelists only the required script sources.

---

## 5. UX/UI Improvements

### HIGH

**U1. No loading states on AI generation**
When a user clicks "Generate Response," there's no skeleton loader or progress indicator beyond a simple toast. For Claude API calls that may take 3–10 seconds, users need clear feedback that the system is working.
*Recommendation:* Add a typing indicator, skeleton loader, or progress animation during AI generation.

**U2. No empty states for new users**
When a new organization is created, the Response History, Favorites, Knowledge Base, and Analytics pages are all empty with no guidance. New users face blank screens with no onboarding prompts.
*Recommendation:* Add empty state illustrations with CTAs like "Generate your first response" or "Import your knowledge base."

**U3. No error recovery on API failures**
If the backend is down or returns an error, the frontend shows a generic toast. There's no retry button, no offline indicator, and no graceful degradation.
*Recommendation:* Add persistent error banners with retry buttons for critical failures. Show connection status.

**U4. Mobile responsiveness gaps**
The 11,795-line `index.html` contains extensive inline CSS but mobile `@media` queries are inconsistent. The admin dashboard and data analysis tools appear optimized for desktop. The landing page has responsive styles in `landing.css`, but tool pages may not render well on small screens.

### MEDIUM

**U5. Inconsistent navigation patterns**
The landing page uses anchor links. The logged-in dashboard uses JavaScript-driven page switching with `switchPage()`. The URL router (`app.js:9581`) covers some routes but not all views. The admin dashboard is a separate JavaScript file with its own tab system. This creates an inconsistent navigation experience.

**U6. No keyboard navigation support**
Interactive elements (tool cards, knowledge base items, modal close buttons) rely on click handlers without keyboard equivalents. No `tabindex`, `role`, or `aria-label` attributes observed on dynamic content.

**U7. Missing alt text on images**
Logo images in the landing page (`index.html`) and case study page (`case-study.html`) need descriptive alt text for screen readers. The favicon SVG loads correctly but partner logos may lack alt text.

**U8. No dark mode support**
The `design-system.css` file defines CSS custom properties but only for a light theme. Given the tool's professional audience who may work long hours, dark mode would be a valuable addition.

**U9. Toast notifications are easy to miss**
Important feedback (success, errors) appears as temporary toast messages that auto-dismiss. For critical actions like payment success or generation errors, more persistent feedback is needed.

### LOW

**U10. Domain redirect on every page load** (`app.js:7–9`)
The frontend redirects `www.lightspeedutility.ca` to `lightspeedutility.ca` via JavaScript. This should be handled at the DNS/hosting level to avoid the extra round-trip.

**U11. Versioned cache-busting is manual** (`index.html:11–13`)
CSS and JS files use manual version strings like `?v=20260207`. These must be updated manually on every deploy.

---

## 6. Feature Recommendations

### SaaS Essentials (Missing)

| Feature | Priority | Notes |
|---------|----------|-------|
| **Server-side usage limits** | Critical | No backend enforcement of the 500 gen/month Starter cap. Users on trial/starter can make unlimited calls. |
| **Subscription status enforcement** | Critical | Expired trials are not blocked from using tools. The `subscription_status` is tracked but not checked before AI tool calls. |
| **Password reset / account recovery** | High | `sendPasswordResetEmail()` exists in `email.js:150` but there is no route to trigger it — the endpoint was removed when email/password auth was dropped. Users locked out of Google have no recovery path. |
| **User roles/permissions in UI** | High | RBAC exists in backend middleware (`requireAdmin`, `requireOwner`) but the frontend doesn't reflect role differences. Members see the same UI as owners. |
| **Organization settings page** | High | The PATCH endpoint exists (`organizations.js:68`) with 12 org profile fields, but there's limited frontend UI for editing all fields. |
| **Email notifications** | Medium | Only invitation and welcome emails exist. Missing: draw reminder emails, usage limit warnings, subscription expiration notices, weekly usage digests. |
| **Audit logging** | Medium | No record of who changed what. Admin actions, role changes, org setting updates should be logged. |
| **Multi-org support** | Low | Currently limited to one org per user. Some nonprofits manage multiple lotteries. |

### Lottery-Specific Feature Opportunities

| Feature | Priority | Description |
|---------|----------|-------------|
| **Template library** | High | Pre-built templates for common lottery emails (draw announcements, winner congrats, deadline reminders). The `draft-knowledge-base.js` has examples but they're not surfaced as a usable template picker in the UI. |
| **Compliance checklist** | High | AGCO regulations are embedded in `knowledge-base.js` as FAQ responses. This could be a dedicated compliance dashboard showing checklist items (licence renewal dates, advertising requirements, subscription consent rules). |
| **Draw result announcement generator** | High | Automated generation of winner announcement posts (social, email, press release) given draw results data. The Draft Assistant partially supports this but lacks a streamlined workflow. |
| **Ticket sales dashboard** | Medium | The Insights Engine analyzes uploaded CSVs, but there's no persistent dashboard showing sales trends over time. Each analysis is one-off. |
| **Player engagement analytics** | Medium | Track repeat purchases, subscription churn, geographic reach over time. Currently only available per-upload in the Insights Engine. |
| **Automated draw schedule sync** | Medium | Currently requires manual upload of Rules of Play documents. Could integrate with lottery platforms (e.g., BUMP Raffle) for automatic schedule updates. |
| **Scheduled content publishing** | Low | Allow users to schedule social posts and emails for future dates (e.g., auto-post draw results). |

### AI/LLM Integration Improvements

| Improvement | Priority | Description |
|------------|----------|-------------|
| **Streaming responses** | High | `services/claude.js:79` has a `streamResponse()` function that's stubbed as `TODO`. Implementing SSE streaming would dramatically improve perceived performance for users waiting on AI generations. |
| **Knowledge base retrieval (RAG)** | High | The `generateWithKnowledge()` function (`claude.js:55`) concatenates ALL matching KB entries into the system prompt. For large knowledge bases, this will hit token limits. Implement proper vector search or keyword-based retrieval to select only the most relevant entries. |
| **Feedback loop integration** | Medium | The `rated-examples` endpoint (`responseHistory.js:234`) fetches positive/negative examples, but these aren't actually injected into AI prompts anywhere in the tools routes. The feedback loop is collected but not used. |
| **Prompt versioning** | Medium | System prompts are hardcoded in route handlers. No way to A/B test or iterate on prompts without code deploys. |
| **Cost tracking per generation** | Medium | Token usage is logged as a combined total. Splitting into input/output tokens would enable accurate cost tracking (the admin cost estimate uses a 40/60 ratio guess — `admin.js:523`). |

### Partially Built / Stubbed Features

| Feature | Status | File:Line |
|---------|--------|-----------|
| Streaming AI responses | TODO stub | `claude.js:79–83` |
| Password reset flow | Email template exists, no route | `email.js:150–168` |
| Response templates (shared) | DB table created, no routes or UI | `001_initial_schema.sql:86–96` |
| Bulk response processing | Referenced in routing (`app.js:9594`) but implementation unclear | `app.js` |
| Ask Lightspeed tool | Route exists (`app.js:9603`) | Frontend partially built |

---

## 7. DevOps & Deployment

### CRITICAL

**D1. No CI/CD pipeline**
There is no `.github/workflows/`, no test suite, no linting, no pre-deploy checks. Code goes directly from git push to production via Render auto-deploy. This means:
- No automated tests catch regressions
- No linting catches code quality issues
- No security scanning on PRs
- No staging environment for testing changes before production
*Recommendation:* At minimum, add a GitHub Actions workflow that runs `npm audit`, ESLint, and basic endpoint smoke tests on every PR.

**D2. No test suite**
Zero test files exist in the project. No unit tests, integration tests, or end-to-end tests. For a SaaS platform handling payments and sensitive nonprofit data, this is a significant risk.
*Recommendation:* Start with integration tests for critical paths: authentication, billing webhooks, AI tool endpoints, and organization access control.

**D3. No database backup strategy**
Render's free PostgreSQL tier has no built-in backups. The `render.yaml` doesn't configure any backup solution. A database failure would mean complete data loss.
*Recommendation:* Upgrade to Render's paid Postgres tier (includes daily backups) or implement scheduled `pg_dump` to an S3 bucket.

### HIGH

**D4. Migration system is fragile** (`index.js:109–126`)
The custom migration runner:
- Has no rollback capability (despite `package.json` listing a `migrate:down` script, there's no `rollback.js` file)
- Runs ALL `.sql` files on every boot
- Relies on `IF NOT EXISTS` and `_migration_flags` table for idempotency
- Migration `004` contains destructive DELETE operations
*Recommendation:* Adopt a proper migration library (`node-pg-migrate`, `knex`, or `prisma migrate`).

**D5. No environment separation**
There's a single `render.yaml` that deploys to production. No staging environment, no preview deployments, no feature flags.
*Recommendation:* Create a `render-staging.yaml` or use Render's preview environments for PR testing.

**D6. Logging is console-only**
All logging uses `console.log/warn/error`. There's no structured logging, no log levels, no log aggregation. In production on Render, console output goes to ephemeral logs that are lost on restart.
*Recommendation:* Add a structured logger (e.g., `pino` or `winston`) with JSON output. Configure Render to forward logs to a service (e.g., Datadog, Logtail).

### MEDIUM

**D7. `render.yaml` missing environment variables**
The following `.env.example` variables are not configured in `render.yaml`:
- `ANTHROPIC_MODEL` — defaults to `claude-sonnet-4-20250514` in code but should be configurable per environment
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`, `FROM_NAME` — email configuration
- `STRIPE_WEBHOOK_SECRET` — required for webhook signature verification
*Recommendation:* Add all required env vars to `render.yaml` (as `sync: false` for secrets).

**D8. No health check beyond basic ping** (`index.js:78–80`)
The `/health` endpoint returns `{ status: 'ok' }` without checking database connectivity, external service availability, or disk space. Render uses this for deployment health checks.
*Recommendation:* Add database ping and optionally Anthropic API key validation to the health check.

**D9. Frontend has no build step**
`render.yaml:36` runs `echo "No build required"` for the frontend build command. This means:
- No minification or bundling
- No dead code elimination
- No compile-time optimizations
- No asset hashing for cache busting
*Recommendation:* Add a minimal build step (even just `terser` for JS minification) to reduce payload size.

### LOW

**D10. `package-lock.json` should be committed**
Ensure `package-lock.json` is in version control for reproducible installs. (It appears to be present.)

**D11. No `.nvmrc` or `engines` field**
No Node.js version is pinned. The `package.json` doesn't specify `engines`. Render will use its default Node version, which could change.
*Recommendation:* Add `"engines": { "node": ">=20.0.0" }` to `package.json` and/or create an `.nvmrc` file.

---

## Summary: Priority Matrix

### Critical (Do First)
1. **S4.** Remove unverified auth fallback — allows account takeover
2. **S1.** Fix SQL interpolation in admin queries
3. **P1.** Replace auto-running migrations with proper migration tool
4. **P2.** Enforce usage limits server-side
5. **D1.** Add basic CI/CD pipeline
6. **D3.** Implement database backup strategy

### High (Do Soon)
7. **S2.** Secure contact form (CAPTCHA + rate limiting)
8. **S5/S6.** Fix XSS in email templates
9. **S8.** Reduce JWT expiry, add refresh tokens
10. **S9.** Upgrade nodemailer to fix vulnerability
11. **H1.** Extract org lookup into middleware
12. **H2.** Move hard-coded values to env vars
13. **C1.** Begin splitting `app.js` into modules
14. **D2.** Add integration tests for critical paths
15. **D4.** Adopt proper database migration library
16. **P3.** Fix N+1 queries in knowledge base import
17. **P5.** Parallelize admin dashboard queries

### Medium (Plan For)
18. Implement streaming AI responses
19. Add server-side subscription status checks
20. Build empty states and onboarding flow
21. Implement audit logging
22. Add structured logging
23. Configure proper CSP headers
24. Add caching layer for read-heavy endpoints
25. Integrate feedback loop into AI prompts

### Low (Nice to Have)
26. Dark mode support
27. Handle www→non-www redirect at DNS level
28. Remove unused `bcryptjs` dependency and `password_hash` column
29. Pin Node.js version
30. Add frontend build step for minification

---

*This audit represents a snapshot of the codebase as of February 9, 2026. Findings should be validated against the latest code before implementation.*
