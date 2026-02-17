# Lightspeed — Technical Brief

**Prepared:** February 13, 2026
**Product:** Lightspeed by Launchpad Solutions
**Version:** 3.0
**Repository:** Private GitHub (launchpadsolutionsdev/lightspeed)

---

## 1. Tech Stack

### Frontend

| Component | Technology | Version / Details |
|-----------|-----------|-------------------|
| Framework | Vanilla JavaScript | No framework (pure JS, HTML, CSS) |
| Auth (Google) | Google Identity Services | CDN (`accounts.google.com/gsi/client`) |
| Auth (Microsoft) | MSAL Browser | v2.38.3 (self-hosted `msal-browser.min.js`) |
| Spreadsheet parsing | SheetJS (XLSX) | v0.20.0 (CDN) |
| Charts | Chart.js | Latest (CDN, unpinned) |
| PDF export | html2pdf.js | v0.10.1 (CDN) |
| Typography | Google Fonts (Inter) | Weights 300–800 |
| Deployment | Render Static Site | No build step required |

**Key files:**

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/app.js` | 10,424 | Core application logic, all tools, auth, API layer |
| `frontend/admin-dashboard.js` | 1,471 | Super-admin platform dashboard |
| `frontend/knowledge-base.js` | 1,152 | Pre-built generic knowledge base entries |
| `frontend/draft-knowledge-base.js` | 644 | Content generation guidelines and brand templates |
| `frontend/draw-schedule.js` | 210 | Draw schedule data and helper functions |
| `frontend/index.html` | 12,081 | Single-page app shell (all UI containers, modals, styles) |
| `frontend/case-study.html` | 231 | Marketing case study (Thunder Bay 50/50) |
| `frontend/design-system.css` | 229 | CSS variables, typography, component styles |
| `frontend/landing.css` | 2,494 | Marketing landing page styles |
| `frontend/admin-dashboard.css` | 1,106 | Admin interface styles |

### Backend

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | — |
| Framework | Express | 4.18.2 |
| Database driver | pg | 8.11.3 |
| Auth tokens | jsonwebtoken | 9.0.2 |
| Google OAuth | google-auth-library | 9.4.1 |
| Microsoft OAuth | @azure/msal-node | 5.0.3 |
| AI/LLM | Anthropic Messages API | Direct fetch (not SDK) |
| Payments | Stripe | 14.14.0 |
| Email | Nodemailer | 6.9.8 |
| File uploads | Multer | 2.0.2 |
| DOCX parsing | Mammoth | 1.11.0 |
| Security headers | Helmet | 7.1.0 |
| Rate limiting | express-rate-limit | 7.1.5 |
| Validation | express-validator | 7.0.1 |
| UUIDs | uuid | 9.0.1 |

**Key files:**

| File | Purpose |
|------|---------|
| `backend/src/index.js` | Server setup, middleware, route mounting, health check, graceful shutdown |
| `backend/src/middleware/auth.js` | JWT verification, role checks, usage limit enforcement |
| `backend/src/services/claude.js` | Anthropic API integration, knowledge base injection |
| `backend/src/services/email.js` | SMTP email service (invitations, welcome, contact) |
| `backend/config/database.js` | PostgreSQL connection pool with SSL |

### Database

| Component | Details |
|-----------|---------|
| Engine | PostgreSQL |
| Hosting | Render Managed (free tier) |
| Connection | Connection pooling via `pg.Pool` |
| SSL | `rejectUnauthorized: true` in production |
| Migrations | 13 sequential SQL files, auto-run on startup |
| ORM | None — raw SQL with parameterized queries |

### AI / LLM Integration

| Setting | Value |
|---------|-------|
| Provider | Anthropic |
| Model | `claude-sonnet-4-6` (configurable via `ANTHROPIC_MODEL` env var) |
| API | Messages API v1 (`https://api.anthropic.com/v1/messages`) |
| API version header | `2023-06-01` |
| Max tokens | 1,024–8,192 depending on tool |
| SDK | Not used — direct `fetch()` to API |

**Knowledge base approach:** Manual injection into system prompt (not vector/RAG). Organization-specific knowledge base entries are appended as `[category] title: content` blocks. Up to 5 positive-rated and 3 negative-rated historical examples are also injected for in-context learning.

### Hosting & Deployment

| Component | Platform | Plan |
|-----------|----------|------|
| Backend API | Render Web Service (Node) | Free |
| Frontend | Render Static Site | Free |
| Database | Render Managed PostgreSQL | Free |
| Domain | `lightspeedutility.ca` | Custom |
| CI/CD | None (manual deploy via Render dashboard) |
| Docker | Not used |

**Config files:** `render.yaml` (root), `render-static.yaml` (frontend)

### Third-Party Services

| Service | Purpose | Integration |
|---------|---------|-------------|
| Anthropic Claude | AI response generation across all 5 tools | Direct API (fetch) |
| Google OAuth | User authentication (One Tap + popup) | google-auth-library |
| Microsoft Azure AD | User authentication (MSAL popup) | @azure/msal-node + MSAL Browser |
| Stripe | Subscription billing (monthly/annual plans) | stripe SDK + webhooks |
| Gmail SMTP | Transactional email (invites, contact form) | Nodemailer |

---

## 2. Architecture Overview

### Structure

Lightspeed is a **monorepo monolith** with two deployment targets:

```
lightspeed/
├── frontend/          # Static SPA (vanilla JS) → Render Static Site
│   ├── index.html     # App shell (12K lines — all views inline)
│   ├── app.js         # Core logic (10K lines — auth, API, tools)
│   ├── admin-dashboard.js
│   ├── knowledge-base.js
│   ├── draft-knowledge-base.js
│   ├── draw-schedule.js
│   ├── msal-browser.min.js
│   ├── *.css
│   └── render-static.yaml
├── backend/           # Express API server → Render Web Service
│   ├── src/
│   │   ├── index.js       # Server entry point
│   │   ├── middleware/     # auth.js (JWT, roles, usage limits)
│   │   ├── routes/        # 12 route modules
│   │   └── services/      # claude.js, email.js
│   ├── config/
│   │   └── database.js    # PostgreSQL pool
│   ├── migrations/        # 13 SQL migration files
│   └── package.json
├── render.yaml        # Render Blueprint (full stack)
├── README.md
├── LICENSE            # MIT
└── .gitignore
```

The frontend is a **single-page application** with DOM-based page switching (`switchPage(pageId)`). There is no bundler, transpiler, or build step — files are served as-is.

The backend is a **standard Express REST API**. All routes are under `/api/*`. The database schema is managed via sequential SQL migration files that run automatically on server startup.

### Key Data Flow: Customer Query → AI Response

```
1. User types customer inquiry into Response Assistant
         ↓
2. Frontend collects context:
   - Customer inquiry text
   - Agent instructions (optional, from staff)
   - Selected tone (professional / friendly / casual)
   - Selected format (email / Facebook / live chat / etc.)
         ↓
3. Frontend fetches additional context from backend:
   - Organization's custom knowledge base entries (GET /api/knowledge-base)
   - Active draw schedule with dates and pricing (GET /api/draw-schedules/active)
   - Up to 5 positively-rated + 3 negatively-rated past responses (GET /api/response-history/rated-examples)
         ↓
4. Frontend constructs prompt and sends POST /api/generate:
   {
     messages: [{ role: "user", content: "<assembled prompt>" }],
     system: "<system prompt with knowledge base + rated examples>",
     tool: "response_assistant",
     max_tokens: 1024
   }
         ↓
5. Backend middleware pipeline:
   authenticate → checkUsageLimit → route handler
         ↓
6. Route handler calls claude.generateWithKnowledge():
   - Appends knowledge entries to system prompt
   - Sends to Anthropic Messages API (claude-sonnet-4-6)
         ↓
7. Response logged to usage_logs table (org_id, user_id, tool, tokens)
         ↓
8. JSON response returned to frontend
         ↓
9. Frontend renders response with copy/save/rate actions
         ↓
10. User can rate response (positive/negative) → saved to response_history
    → Rated responses feed back into step 3 for future queries
```

### Knowledge Base Storage & Retrieval

Knowledge base entries are stored in the `knowledge_base` PostgreSQL table:

```sql
knowledge_base (
    id UUID,
    organization_id UUID,    -- tenant isolation
    title VARCHAR,
    content TEXT,
    category VARCHAR,        -- products, policies, faqs, other
    tags TEXT[],
    created_by UUID
)
```

**Retrieval:** All entries for the user's organization are fetched via `GET /api/knowledge-base` and injected into the Claude system prompt as plain text. There is no vector database or semantic search — this is a **full-context injection** approach suitable for small-to-medium knowledge bases (typically 50–200 entries per organization).

**Sources:** Entries can be created manually or imported from DOCX files (parsed via Mammoth).

---

## 3. Key Features (Technical Perspective)

### 3.1 Response Assistant (Customer Service AI)

**Route:** `POST /api/generate`
**File:** `backend/src/routes/tools.js`

The flagship tool. Generates context-aware customer service responses by combining:
- The customer's inquiry
- Optional agent instructions (e.g., "I've already cancelled their subscription")
- Organization-specific knowledge base (FAQs, policies, product info)
- Active draw schedule (dates, prizes, pricing, early bird draws)
- Historically rated responses (positive examples to emulate, negative to avoid)
- Selected tone and format

Supports output formats: email reply, Facebook message, live chat, phone script, internal note.

Includes a **feedback loop** — staff can rate responses as positive/negative with optional correction text. Rated responses are injected as few-shot examples in future prompts, creating a continuous improvement cycle.

**Quick instruction chips** allow one-click agent context: "Resolved", "Cancelled", "Refund approved", "Escalate", "Resent tickets".

### 3.2 Draft Assistant (Content Creation)

**Route:** `POST /api/draft`
**File:** `backend/src/routes/tools.js`

AI-powered content creation for marketing and communications:
- Social media posts (Facebook, Instagram, Twitter)
- Email campaigns (new draw announcements, reminders, winner notifications)
- Press releases
- Internal communications

Uses organization brand voice settings, terminology, and content guidelines stored in `organizations.brand_voice` and `organizations.brand_terminology` (JSONB).

### 3.3 Insights Engine (Data Analysis)

**Route:** `POST /api/analyze`
**File:** `backend/src/routes/tools.js`

Analyzes uploaded sales/customer data. Users upload Excel files which are parsed client-side via SheetJS. The parsed data is sent to Claude for analysis with configurable report types. Frontend renders results with Chart.js visualizations including heat maps, revenue breakdowns, and top buyer segments.

### 3.4 List Normalizer

**Route:** `POST /api/normalize`
**File:** `backend/src/routes/tools.js`

Cleans and standardizes data lists. Two modes:
- **Standard mode:** Claude returns cleaned/deduplicated data
- **Transform mode:** Claude generates a JavaScript transformation function that runs client-side via `new Function()` for batch processing

### 3.5 Ask Lightspeed (General AI Assistant)

**Route:** `POST /api/generate` (shared with Response Assistant)

Full-featured conversational AI assistant with organization context. Can help with anything — emails, strategy, analysis, coding. Has access to the same knowledge base and draw schedule context as the Response Assistant.

### 3.6 Admin Dashboard (Super Admin)

**Route:** `GET /api/admin/dashboard`
**File:** `backend/src/routes/admin.js`, `frontend/admin-dashboard.js`

Platform-level administration for super admins:
- User management (all platform users)
- Organization management (status, billing, members)
- Usage analytics and cost tracking
- Activity feed

Access controlled by `is_super_admin` flag on user record.

### 3.7 Team Management & Multi-Tenancy

**Routes:** `/api/organizations/*`
**File:** `backend/src/routes/organizations.js`

Full multi-tenant architecture:
- Organizations are the primary tenant boundary
- Members have roles: owner, admin, member
- Email-based invitation system with 7-day expiring tokens
- All data (knowledge base, response history, favorites, draw schedules, templates) is scoped to organization

### 3.8 Billing & Subscriptions

**Routes:** `/api/billing/*`
**File:** `backend/src/routes/billing.js`

Stripe-powered subscription management:
- **Trial:** 14 days, 20 AI generations limit
- **Paid:** 500 AI generations/month
- Plans: Monthly (`price_1Sy220D0OAjcDsbxhriCFRTT`) and Annual (`price_1Sy220D0OAjcDsbxhAjDMmPM`)
- Stripe Checkout for new subscriptions
- Stripe Customer Portal for self-service management
- Webhook handlers for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`

---

## 4. Security & Authentication

### Authentication Flow (End-to-End)

```
    User clicks "Sign in with Google" or "Sign in with Microsoft"
                        ↓
    OAuth popup flow (Google Identity Services / MSAL Browser)
                        ↓
    Frontend receives credential token
                        ↓
    POST /api/auth/google  OR  POST /api/auth/microsoft
    { credential/accessToken, email, name }
                        ↓
    Backend verifies token:
      Google: googleClient.verifyIdToken() with GOOGLE_CLIENT_ID
      Microsoft: fetch Microsoft Graph /me endpoint with accessToken
                        ↓
    User record created or updated in PostgreSQL
    (google_id / microsoft_id linked to user)
                        ↓
    Check for pending organization invitations by email
    → Auto-join organization if invitation exists
                        ↓
    JWT generated: jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' })
                        ↓
    JWT returned to frontend → stored in localStorage('authToken')
                        ↓
    All subsequent API requests include: Authorization: Bearer <token>
                        ↓
    authenticate middleware verifies JWT on every protected route
```

### OAuth Providers

| Provider | Client Library | Client ID Location | Backend Verification |
|----------|---------------|-------------------|---------------------|
| Google | Google Identity Services (CDN) | Hardcoded in `app.js` + `GOOGLE_CLIENT_ID` env var | `google-auth-library` verifyIdToken |
| Microsoft | MSAL Browser v2.38.3 (local) | Hardcoded in `app.js` as `a7e282d3-9f3a-4bca-a72f-f100e498f0d6` | Microsoft Graph API `/me` endpoint |

### Authorization Model

| Level | Mechanism | Middleware |
|-------|-----------|-----------|
| Authenticated user | JWT in Authorization header | `authenticate` |
| Organization member | Membership lookup in `organization_memberships` | `requireOrganization` |
| Admin | Role check: `owner` or `admin` | `requireAdmin` |
| Owner | Role check: `owner` only | `requireOwner` |
| Super admin | `is_super_admin` flag on user record | `requireSuperAdmin` |

### API Key & Environment Variable Management

All secrets are managed via environment variables (never committed to source):

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | JWT signing key (auto-generated on Render) | Yes |
| `ANTHROPIC_API_KEY` | Claude API access | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth audience verification | Yes |
| `MICROSOFT_CLIENT_ID` | Azure AD app registration | No |
| `MICROSOFT_CLIENT_SECRET` | Azure AD server-side auth | No |
| `STRIPE_SECRET_KEY` | Stripe API access | No |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | No |
| `SMTP_HOST` | Email server hostname | No |
| `SMTP_PORT` | Email server port | No |
| `SMTP_USER` | Email account username | No |
| `SMTP_PASS` | Email account password (Gmail app password) | No |
| `FRONTEND_URL` | CORS allowlist + email link generation | No |
| `CONTACT_EMAIL` | Contact form recipient | No |
| `TRIAL_DAYS` | Trial period length (default: 14) | No |
| `NODE_ENV` | Environment mode | No |

**Startup validation:** The server exits immediately if any of `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, or `GOOGLE_CLIENT_ID` is missing.

### Security Measures

| Measure | Implementation |
|---------|---------------|
| Security headers | Helmet middleware (HSTS, X-Frame-Options, etc.) |
| CORS | Allowlisted origins only; localhost blocked in production |
| Rate limiting (general) | 60 requests/minute per IP on `/api/*` |
| Rate limiting (auth) | 20 requests/15 minutes per IP on `/api/auth` |
| SQL injection prevention | Parameterized queries throughout (no raw interpolation) |
| HTML injection prevention | `escapeHtml()` on all user input in email templates |
| Usage limits | Trial: 20 generations total; Paid: 500/month (fail-closed) |
| SSL/TLS | `rejectUnauthorized: true` for database connections in production |
| Clickjacking | `X-Frame-Options: DENY` header on frontend |
| Input validation | `express-validator` on key endpoints |
| Webhook verification | Stripe signature verification with raw body parsing |

---

## 5. Deployment & Infrastructure

### Render Blueprint (`render.yaml`)

The entire stack is defined in a single Render Blueprint:

```yaml
services:
  - type: web              # Backend API
    name: lightspeed-api
    env: node
    plan: free
    rootDir: backend
    buildCommand: npm install
    startCommand: npm start

  - type: web              # Frontend
    name: lightspeed-frontend
    env: static
    rootDir: frontend
    buildCommand: echo "No build required"
    staticPublishPath: .

databases:
  - name: lightspeed-db    # PostgreSQL
    plan: free
```

### Environment Setup

**Production (Render):**
1. Push to GitHub triggers Render auto-deploy (when configured)
2. Backend: `npm install` → `npm start` (runs `node src/index.js`)
3. On startup: migrations auto-apply, email config validated, server binds to `0.0.0.0:$PORT`
4. Frontend: static files served as-is with SPA rewrite rule (`/* → /index.html`)
5. Database: Render-managed PostgreSQL, connection string injected via `DATABASE_URL`

**Local development:**
1. Copy `backend/.env.example` → `backend/.env` and fill in values
2. `cd backend && npm install && npm run dev` (uses Nodemon for hot reload)
3. Serve frontend with any static server on port 8000 (e.g., `python -m http.server 8000`)
4. Frontend auto-detects localhost and points API calls to `http://localhost:3001`

### Infrastructure Diagram

```
                    ┌─────────────────────────┐
                    │   lightspeedutility.ca   │
                    │    (Custom Domain)       │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
           ┌───────┴───────┐        ┌────────┴────────┐
           │   Frontend    │        │   Backend API   │
           │  Render Static│        │  Render Web Svc │
           │  (No build)   │        │  (Node/Express) │
           └───────────────┘        └────────┬────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              │              │              │
                    ┌─────────┴──┐  ┌────────┴───┐  ┌──────┴──────┐
                    │ PostgreSQL │  │ Anthropic   │  │   Stripe    │
                    │ Render DB  │  │ Claude API  │  │ Billing API │
                    └────────────┘  └────────────┘  └─────────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              │              │              │
                    ┌─────────┴──┐  ┌────────┴───┐  ┌──────┴──────┐
                    │ Google     │  │ Microsoft  │  │ Gmail SMTP  │
                    │ OAuth      │  │ Azure AD   │  │ (Email)     │
                    └────────────┘  └────────────┘  └─────────────┘
```

### Database Schema (13 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | User accounts | email, google_id, microsoft_id, is_super_admin |
| `organizations` | Tenant entities | name, slug, subscription_status, stripe_customer_id, brand_voice |
| `organization_memberships` | User ↔ Org relationship | user_id, organization_id, role (owner/admin/member) |
| `organization_invitations` | Pending invites | email, token, expires_at, role |
| `usage_logs` | AI generation tracking | organization_id, user_id, tool, total_tokens |
| `knowledge_base` | Custom FAQ/policy entries | organization_id, title, content, category, tags |
| `response_history` | Generated response archive | inquiry, response, format, tone, tool, rating |
| `favorites` | Saved favorite responses | user_id, title, inquiry, response |
| `feedback` | User feedback | type, message |
| `response_templates` | Reusable templates | name, content, category, is_shared |
| `draw_schedules` | Lottery draw configs | draw_name, grand_prize_date, early_birds (JSONB), pricing (JSONB) |
| `content_templates` | System + org content templates | template_type, subject, headline, content, metadata (JSONB) |

### Indexed Columns

| Index | Table | Column(s) |
|-------|-------|-----------|
| Primary keys | All tables | `id` |
| Unique | users | `email`, `google_id`, `microsoft_id` |
| Unique | organizations | `slug` |
| Performance | usage_logs | `user_id` |
| Performance | response_history | `(organization_id, created_at DESC)` |
| Performance | knowledge_base | `organization_id` |
| Performance | organization_memberships | `user_id` |

---

## Appendix: Dependency List (backend/package.json)

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.17.1",
    "@azure/msal-node": "^5.0.3",
    "cors": "^2.8.5",
    "dotenv": "^16.6.1",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "express-validator": "^7.0.1",
    "google-auth-library": "^9.4.1",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "mammoth": "^1.11.0",
    "multer": "^2.0.2",
    "nodemailer": "^6.9.8",
    "pg": "^8.11.3",
    "stripe": "^14.14.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```
