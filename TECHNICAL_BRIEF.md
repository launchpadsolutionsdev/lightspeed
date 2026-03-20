# Lightspeed — Technical Brief

**Prepared for:** Technical Due Diligence Review
**Date:** March 2026
**Version:** 1.1

---

## 1. Executive Summary

Lightspeed is an AI-powered SaaS productivity platform purpose-built for charitable lottery operators in Canada. It solves a specific and underserved problem: small-to-mid-size charitable organizations running lotteries, raffles, and 50/50 draws lack the in-house marketing, compliance, and operational expertise to run these programs efficiently. Lightspeed gives them an AI assistant that already knows their business — their products, their customers, their regulatory environment, and their brand voice.

The platform provides five core AI tools: a **Response Assistant** for generating customer-facing replies, a **Draft Assistant** for creating marketing content (social posts, emails, press releases, ads), an **Insights Engine** for analyzing sales and operational data, a **List Normalizer** for cleaning messy data exports, and a **Compliance Assistant** that provides jurisdiction-specific regulatory guidance backed by verified knowledge bases. A sixth module, **Ask Lightspeed**, is an agentic AI interface that combines 12 internal tools (KB search, calendar management, content drafting, response history, Home Base search, Shopify queries, Heartbeat analytics, chart rendering, and more) plus server-managed **web search** in a single natural-language interface with AI-generated follow-up suggestions. Additional modules include **Raffle Heartbeat** for real-time sales velocity tracking, a **Rules of Play Generator** for jurisdiction-aware regulatory document drafting, and **Shared Prompts** for team-wide prompt libraries with activity tracking.

Lightspeed is deployed as a multi-tenant SaaS application with organization-level isolation. Each organization maintains its own knowledge base, response rules, brand voice profile, and usage history. The platform integrates with Shopify for e-commerce analytics, Stripe for subscription billing, and supports Google and Microsoft OAuth for authentication. It is currently in production serving charitable lottery operators in Ontario, Canada.

---

## 2. Tech Stack Overview

### Languages & Runtime
| Technology | Version | Role |
|---|---|---|
| Node.js | 20.x | Backend runtime |
| JavaScript (ES2022+) | — | Backend and frontend language |
| SQL | — | Database queries and migrations |

### Backend Framework & Libraries
| Package | Version | Purpose |
|---|---|---|
| Express | 4.18.2 | HTTP server framework |
| Helmet | 7.1.0 | Security headers middleware |
| CORS | 2.8.5 | Cross-origin resource sharing |
| express-rate-limit | 7.1.5 | Request rate limiting |
| express-validator | 7.0.1 | Input validation |
| jsonwebtoken | 9.0.2 | JWT token generation/verification |
| pg | 8.11.3 | PostgreSQL client |
| Stripe | 14.14.0 | Payment processing SDK |
| Nodemailer | 8.0.1 | Transactional email (SMTP) |
| Multer | 2.0.2 | File upload handling |
| pdf-parse | 2.4.5 | PDF text extraction |
| Mammoth | 1.11.0 | DOCX-to-HTML conversion |
| xlsx | 0.18.5 | Excel/CSV parsing |
| fast-xml-parser | 5.5.6 | XML parsing |
| uuid | 9.0.1 | UUID generation |
| google-auth-library | 9.4.1 | Google OAuth verification |
| @azure/msal-node | 5.0.3 | Microsoft OAuth (MSAL) |
| @anthropic-ai/sdk | 0.17.1 | Anthropic Claude SDK (available; raw fetch used for streaming) |

### AI & ML Services
| Service | Model | Purpose |
|---|---|---|
| Anthropic Claude API | claude-sonnet-4-6 (primary) | Response generation, content drafting, analysis |
| Anthropic Claude API | claude-haiku-4-5-20251001 | KB relevance picking, voice profiling, example filtering, web search follow-up suggestions |
| Voyage AI | voyage-3-lite (512d) | Text embeddings for semantic search |

### Database
| Technology | Version | Purpose |
|---|---|---|
| PostgreSQL | 16.x (Render-managed) | Primary data store |
| pgvector | — | Vector similarity search for semantic KB retrieval |
| pgcrypto | — | UUID generation |

### Frontend
| Technology | Purpose |
|---|---|
| Vanilla JavaScript (ES2022) | Single-page application, no framework |
| CSS3 (custom design system) | Styling with custom design tokens |
| MSAL Browser SDK | Microsoft authentication in browser |
| Chart.js (CDN) | Analytics visualizations (dashboard + Ask Lightspeed inline charts) |

### Infrastructure & Deployment
| Service | Purpose |
|---|---|
| Render | Hosting (backend web service + static frontend + managed PostgreSQL) |
| GitHub Actions | CI/CD (test + lint on PR/push) |
| Gmail SMTP | Transactional email delivery |

### Development Tools
| Tool | Version | Purpose |
|---|---|---|
| Jest | 29.7.0 | Backend unit testing |
| Supertest | 7.2.2 | HTTP integration testing |
| ESLint | (flat config) | Code linting |
| Nodemon | 3.0.2 | Development hot-reload |

---

## 3. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FRONTEND                                   │
│  Static site (Render) — Vanilla JS SPA                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Response  │ │  Draft   │ │ Insights │ │   Ask    │ │Compliance│ │
│  │ Assistant │ │ Assistant│ │  Engine  │ │Lightspeed│ │ Assistant│ │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └─────┬────┘ └─────┬────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                            │
│  │Heartbeat │ │ Rules of │ │  Shared  │                            │
│  │Dashboard │ │   Play   │ │  Prompts │                            │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘                            │
└────────┼────────────┼────────────┼────────────────────────────┬─────┘
         │            │            │                            │
         ▼            ▼            ▼                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND API (Express)                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Auth/RBAC  │  │   Prompt   │  │  Claude AI  │  │   Shopify   │  │
│  │ Middleware │  │  Builders  │  │   Service   │  │   Service   │  │
│  └────────────┘  └────────────┘  └────────────┘  └─────────────┘  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Voice      │  │  Token     │  │  Embedding  │  │   Cache     │  │
│  │ Fingerprint│  │  Counter   │  │  Service    │  │   Service   │  │
│  └────────────┘  └────────────┘  └────────────┘  └─────────────┘  │
└──────────┬──────────────────────┬──────────────────────┬───────────┘
           │                      │                      │
           ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐
│   PostgreSQL     │  │  Anthropic API   │  │   External Services   │
│   + pgvector     │  │  (Claude/Haiku)  │  │  Shopify · Stripe     │
│                  │  │  Voyage AI       │  │  Google · Microsoft   │
└──────────────────┘  └──────────────────┘  │  Gmail SMTP           │
                                            └───────────────────────┘
```

### Deployment Model

Lightspeed deploys as a **monorepo** with two Render services:

1. **Backend API** (`lightspeed-api`) — Node.js web service running Express. Handles all API requests, AI generation, and background jobs (calendar reminders, scheduled posts, analytics sync).
2. **Frontend** (`lightspeed-frontend`) — Static site serving vanilla HTML/JS/CSS files. All routes rewrite to `index.html` for SPA behavior.
3. **Database** (`lightspeed-db`) — Render-managed PostgreSQL instance with pgvector extension.

**CI/CD:** GitHub Actions runs on push/PR to `main`/`develop`. The pipeline runs backend tests (Jest) and linting (ESLint). Render auto-deploys from the main branch.

**Environment Management:** Configuration is managed through environment variables (see `.env.example` for the full list). Required variables are validated at startup: `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`. The application exits immediately if any are missing.

---

## 4. Module-by-Module Breakdown

### 4.1 Response Assistant

**What it does:** Generates professional customer-facing responses for lottery operators. Takes a customer inquiry, applies organization-specific context (brand voice, knowledge base, response rules, Shopify order data), and produces a formatted reply in the specified tone and format.

**How it works:** The frontend sends parameters (inquiry, format, tone, language, thread context) to the backend. The `systemPromptBuilder` assembles a two-layer prompt: Layer 1 (static, cached) contains the base Response Assistant persona and instructions; Layer 2 (dynamic, per-request) injects organization profile, knowledge base entries, response rules, Shopify context, voice fingerprint, past corrections, calendar events, and conversation memory. The `promptBuilder` orchestrates a 4-tier knowledge base search (semantic vector → full-text chunk → full-text parent → tag matching) to find the most relevant entries. Claude Haiku performs relevance picking to select the top entries. The response streams back via SSE and is post-validated by the `outputValidator` for prompt leakage, PII, and format compliance.

**Key files:**
- `backend/src/routes/tools.js` — API endpoints (`POST /api/response-assistant/generate`, `POST /api/generate-stream`)
- `backend/src/services/systemPromptBuilder.js` — Two-layer prompt construction
- `backend/src/services/promptBuilder.js` — Context injection orchestrator
- `backend/src/services/claude.js` — Anthropic API client
- `backend/src/services/outputValidator.js` — Post-generation validation
- `frontend/app.js` — UI and SSE stream handling

**Data flow:** Inquiry → prompt enhancement (KB + rules + Shopify + voice + memory + corrections) → Claude API (streaming) → output validation → SSE to frontend.

### 4.2 Draft Assistant

**What it does:** Creates marketing and communications content: social media posts (Facebook, Instagram, LinkedIn, Twitter), email campaigns (new draw, reminders, winners, impact stories), press releases, advertisements, and free-form content (board reports, grant applications, talking points).

**How it works:** Uses a specialized two-layer prompt architecture. The static layer (`DRAFT_STATIC_PROMPT`, ~250 lines) is cached across requests and contains content-type templates, formatting rules, and platform-specific constraints. The dynamic layer fetches the organization's profile, brand guidelines, recent templates, upcoming calendar events, and highest-rated examples. A dedicated `buildDraftUserPrompt()` function constructs content-type-specific user messages. The Draft Assistant maintains separate voice fingerprint profiles from the Response Assistant.

**Key files:**
- `backend/src/services/draftPromptBuilder.js` — Static/dynamic prompt construction
- `backend/src/routes/tools.js` — Streaming endpoint (shared with Response Assistant)
- `frontend/app.js` — Draft UI with content type selection, platform targeting, and template management

**External dependencies:** PostgreSQL (org profile, templates, calendar events, response history).

### 4.3 Insights Engine

**What it does:** Analyzes uploaded data (Excel/CSV files or connected Shopify analytics) and generates AI-powered reports with trends, insights, and recommendations.

**How it works:** Users upload Excel/CSV files or pull live Shopify data. The backend parses the data, formats it as structured context, and passes it to Claude with a report-type-specific system prompt. Supports multiple report types: sales analysis, player demographics, marketing performance, and general data analysis. Uses a lighter context injection profile (capped KB and calendar, no response rules or Shopify context) to maximize the token budget available for data.

**Key files:**
- `backend/src/routes/tools.js` — `POST /api/analyze` endpoint
- `backend/src/services/shopify.js` — `buildAnalyticsSummary()` for Shopify data
- `frontend/app.js` — File upload UI and report rendering

### 4.4 List Normalizer

**What it does:** Cleans and standardizes messy data (customer lists, Excel exports, volunteer rosters) using AI-generated transform functions.

**How it works:** The user pastes or uploads raw data. Claude generates a JavaScript transform function that maps messy rows to clean, standardized objects. The function is executed client-side (via `new Function()`) to transform each row. No context injection is used — the normalizer operates without KB, rules, or Shopify data to minimize latency.

**Key files:**
- `backend/src/routes/tools.js` — `POST /api/normalize` endpoint
- `frontend/app.js` — Data grid UI, transform execution, export to CSV

### 4.5 Ask Lightspeed (Agentic AI)

**What it does:** A conversational AI assistant with 12 internal tools plus server-managed web search. It can search the knowledge base, create and query calendar events, draft content, query response history, search Home Base posts, look up Shopify orders and customers, query Heartbeat sales velocity data, render interactive Chart.js visualizations, and perform live web searches with source attribution. It also generates AI-powered follow-up suggestions after web searches.

**How it works:** Uses Anthropic's **tool_use** (function calling) feature. The backend defines 12 tool schemas plus a server-managed `web_search_20250305` tool (conditionally enabled). Claude decides which tools to call based on the user's query. Write operations (calendar event creation, KB saves) require a confirmation loop — Claude proposes the action, the frontend shows a confirmation dialog, and the user approves before execution. After web search responses, Haiku generates follow-up search suggestions. Conversations are persisted with auto-generated summaries for memory retrieval.

**Tools:**
1. `search_knowledge_base` — Search org KB for policies, procedures, FAQs
2. `search_runway_events` — Search/query calendar events
3. `create_runway_events` — Create calendar events (requires confirmation)
4. `draft_content` — Generate marketing/communications content
5. `save_to_knowledge_base` — Save information to KB (requires confirmation)
6. `search_response_history` — Query past AI-generated responses
7. `search_home_base` — Search team bulletin board/announcements
8. `run_insights_analysis` — Data analysis on uploaded files
9. `search_shopify_orders` — Query Shopify order data
10. `search_shopify_customers` — Query Shopify customer data
11. `search_heartbeat_data` — Query real-time raffle sales velocity data
12. `render_chart` — Render interactive Chart.js visualizations (bar, line, pie, doughnut, horizontal bar)
13. `web_search` (server-managed) — Live web search with source attribution (opt-in)

**Key files:**
- `backend/src/routes/askLightspeed.js` — Tool definitions, confirmation loop, conversation management
- `backend/src/services/conversationMemory.js` — Conversation history and cross-tool context
- `frontend/app.js` — Conversation UI with tool call rendering and chart display

### 4.6 Compliance Assistant

**What it does:** Provides regulatory guidance for charitable gaming operations, scoped to specific jurisdictions (currently Ontario). Answers are exclusively sourced from a verified, curated knowledge base — the AI cannot generate answers outside the KB.

**How it works:** The `compliancePromptBuilder` constructs a highly constrained system prompt with 8 critical rules that prevent the AI from generating unverified information. Every response must include inline citations (`[Citation: entry_id]`) linking to specific KB entries. Responses include a mandatory disclaimer, stale data warnings (entries >90 days old), and regulatory body contact information. The compliance KB is seeded from curated JSON files covering Ontario's gaming regulations.

**Key files:**
- `backend/src/routes/compliance.js` — Streaming endpoint with citation tracking
- `backend/src/services/compliancePromptBuilder.js` — System prompt with KB-only constraint
- `backend/data/ontario-*-kb-entries.json` — Curated regulatory knowledge base (12 files)
- `frontend/compliance.js` — Compliance UI with citation rendering

### 4.7 Home Base (Internal Communications)

**What it does:** An internal communications hub for organization teams. Supports posts, comments, reactions, categories, scheduled publishing, digest emails, bookmarks, and link previews.

**Key files:**
- `backend/src/routes/homeBase.js` — Full CRUD + scheduled posts + digest emails
- `frontend/app.js` — Home Base UI

### 4.8 Content Calendar (Runway)

**What it does:** A shared calendar for planning lottery draws, marketing campaigns, and events. Supports recurring events, reminders, comments, and notifications.

**Key files:**
- `backend/src/routes/contentCalendar.js` — Calendar CRUD + recurring event expansion + reminder checker
- `frontend/app.js` — Calendar UI

### 4.9 Shopify Dashboard

**What it does:** Analytics dashboard for connected Shopify stores showing sales trends, top products, customer insights, and order lookup.

**Key files:**
- `backend/src/services/shopify.js` — Shopify REST API integration
- `backend/src/services/shopifyAnalytics.js` — Incremental analytics sync via ShopifyQL
- `backend/src/routes/shopify.js` — OAuth flow, webhooks, product sync
- `frontend/shopify-dashboard.js` — Dashboard UI with Chart.js visualizations

### 4.10 Admin Dashboard

**What it does:** Super-admin panel for platform-wide management: user management, organization setup, usage analytics, cost estimation, audit logs, and bulk operations.

**Key files:**
- `backend/src/routes/admin.js` — Admin-only endpoints (requires `is_super_admin`)
- `frontend/admin-dashboard.js` — Admin UI

### 4.11 Raffle Heartbeat (Feed Dashboard)

**What it does:** Real-time sales velocity monitoring for active raffles. Tracks sales data across 8 time windows (1m, 5m, 10m, 30m, 1h, 3h, 24h, 7d), detects surges, and calculates percent-change deltas. Also serves as the platform's "What's New" article feed.

**How it works:** Background fetcher runs every 90 seconds to pull raffle data from the BUMP API, building a continuous timeline of velocity snapshots stored in PostgreSQL with 7-day retention and 2-minute caching. The Heartbeat data is also available as a tool in Ask Lightspeed (`search_heartbeat_data`).

**Key files:**
- `backend/src/routes/feedDashboard.js` — Feed parsing, velocity snapshots, What's New endpoint
- `backend/migrations/053_velocity_snapshots_table.sql` — Velocity snapshots table
- `frontend/app.js` — Heartbeat dashboard UI

### 4.12 Rules of Play Generator

**What it does:** AI-powered generation of Rules of Play documents for charitable lottery operators. Supports multiple raffle types (50/50, Catch the Ace, prize raffle, house lottery) with jurisdiction-aware regulatory content.

**How it works:** Users select a raffle type and jurisdiction, optionally upload reference documents (DOCX/PDF). Claude generates a complete Rules of Play draft using the organization's profile and regulatory body information. Drafts are saved for iterative editing and can be exported to .doc format.

**Key files:**
- `backend/src/routes/rulesOfPlay.js` — CRUD, AI generation, reference document upload, .doc export
- `backend/migrations/017_rules_of_play.sql` — Rules of Play drafts table

### 4.13 Shared Prompts & Team Activity

**What it does:** Organization-wide prompt library for sharing reusable prompts across the team, with usage tracking and a team activity feed showing recent AI usage.

**Key files:**
- `backend/src/routes/sharedPrompts.js` — Prompt CRUD, usage tracking, team activity endpoint

---

## 5. AI/LLM Integration

### Model Selection

Lightspeed uses two Claude models in a tiered architecture:

- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — Primary generation model for all user-facing responses. Used for Response Assistant, Draft Assistant, Insights Engine, List Normalizer, Ask Lightspeed, and Compliance Assistant.
- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — Lightweight model for internal processing tasks: KB relevance picking, rated example filtering, voice fingerprint analysis, conversation summarization, and web search follow-up suggestion generation.

The primary model is configurable via the `ANTHROPIC_MODEL` environment variable. Users can select between Sonnet and Opus via the model selector; Haiku is not user-selectable but is used internally for operations where speed and cost matter more than output quality.

### System Prompt Architecture

Lightspeed implements a **two-layer prompt architecture** designed for Anthropic's prompt caching:

- **Layer 1 (Static, Cached):** The base persona, instructions, formatting rules, and tool-specific templates. This layer is identical across all requests for a given tool and is sent with `cache_control: { type: 'ephemeral' }` to enable cross-request caching. For the Response Assistant, this is ~2,000 tokens. For the Draft Assistant, this is ~4,000 tokens.

- **Layer 2 (Dynamic, Per-Request):** Organization-specific context injected for each request:
  - Organization profile (name, lottery type, brand voice guidelines)
  - Knowledge base entries (selected via 4-tier relevance search)
  - Response rules (custom instructions like "always mention our website")
  - Shopify context (relevant order/customer data extracted from the inquiry)
  - Voice fingerprint (learned writing style from approved responses)
  - Past corrections (feedback from thumbs-down ratings)
  - Calendar events (upcoming 30 days)
  - Conversation memory (relevant past conversations)
  - Cross-tool context (recent activity from other tools, last 72 hours)

### Tool Definitions (Ask Lightspeed)

Ask Lightspeed uses Anthropic's tool_use feature with 12 internal tools plus a server-managed web search tool. See Section 4.5 for the complete tool list. Key architectural patterns:

- **Confirmation loop:** Write operations (`create_runway_events`, `save_to_knowledge_base`) require frontend confirmation before execution
- **Server-managed tools:** Web search (`web_search_20250305`) is conditionally enabled and managed by Anthropic's API
- **Chart rendering:** The `render_chart` tool returns Chart.js configurations that the frontend renders as interactive visualizations
- **Follow-up suggestions:** After web search responses, Haiku generates follow-up search suggestions asynchronously

### Caching Strategy

Lightspeed implements a **3-tier prompt caching strategy** using Anthropic's `cache_control: { type: 'ephemeral' }`:

1. **Tools array** — Tool definitions are cached (marker on last tool in array), shared across all requests for the same tool set
2. **Static system prompt** — Base persona, instructions, and formatting rules are cached as a separate system block
3. **Dynamic system prompt** — Organization-specific context (KB, rules, memory) is cached as a second system block, enabling partial cache hits when only the user message changes

Cache performance is logged per request (`cache_read_input_tokens`, `cache_creation_input_tokens`).

- In-memory TTL cache on the backend for KB entries (2 min), response rules (2 min), auth/org mappings (5 min), usage counts (60s), voice profiles (1 hour), analytics (2 min), and velocity snapshots (2 min)
- Haiku relevance picking results are not cached (they depend on the inquiry)

### Hallucination Guardrails

1. **KB-only constraint** (Compliance Assistant): System prompt explicitly forbids generating information not present in the provided knowledge base. Requires inline citations for every factual claim.
2. **Relevance picking**: Haiku pre-filters KB entries so only relevant information reaches the generation model, reducing the chance of the model confabulating from irrelevant context.
3. **Output validation**: Post-generation checks for prompt leakage patterns (23 known fragments), PII exposure, and format compliance violations.
4. **Prompt injection detection**: Input sanitization scans for 7 known injection patterns (e.g., "ignore previous instructions") and replaces them with `[filtered]`.
5. **User content wrapping**: User-provided content is wrapped in XML delimiters (`<customer_inquiry>`, `<thread_context>`) to help the model distinguish user input from system instructions.

### Multi-Turn Conversations

Ask Lightspeed maintains full conversation history:
- Messages are stored in a PostgreSQL JSONB column per conversation
- Conversations are auto-summarized (via Haiku) when they exceed a length threshold
- Summaries are embedded (Voyage AI) for semantic retrieval in future conversations
- Cross-tool context surfaces recent activity from other tools in the last 72 hours

### Token Budget Management

The `budgetAllocator` classifies inquiry complexity (simple/medium/complex) using heuristics (word count, question count, complexity signals) and allocates token budgets proportionally:

| Complexity | KB Budget | Memory | Examples | Max KB Entries |
|---|---|---|---|---|
| Simple | 5,000 | 2,000 | 3,000 | 3 |
| Medium | 25,000 | 5,000 | 5,000 | 8 |
| Complex | 50,000 | 10,000 | 8,000 | 15 |

The `tokenCounter` enforces a 75% input budget (reserving 25% for output + safety margin) and truncates KB entries when the budget is exceeded.

---

## 6. Authentication & Authorization

### Authentication Flows

Lightspeed supports two OAuth providers:

**Google OAuth:**
1. Frontend initiates Google Sign-In (One Tap or popup)
2. Google returns a JWT credential
3. Backend verifies the credential via `google-auth-library`
4. If user exists → return JWT. If new → create user, auto-join pending invitations, return JWT.

**Microsoft OAuth (MSAL):**
1. Frontend initiates MSAL login popup
2. Microsoft returns an authorization code
3. Backend exchanges code for tokens via `@azure/msal-node`
4. Backend fetches user profile from Microsoft Graph API (`/me`, `/me/photo`)
5. Same user creation / login flow as Google

### Session Management

- JWT tokens with configurable expiration (default: 7 days)
- Tokens contain only `userId` — all other data is fetched from the database on each request
- No refresh token mechanism — users re-authenticate when the token expires
- Token is stored in `localStorage` on the frontend

### Role-Based Access Control

Three levels of authorization middleware:

1. **`authenticate`** — Verifies JWT, loads user from DB, resolves organization membership, caches org ID
2. **`requireOrganization`** — Verifies the user is a member of the requested organization (from URL param)
3. **Role checks:**
   - `requireAdmin` — Requires `owner` or `admin` role
   - `requireOwner` — Requires `owner` role only
   - `requireSuperAdmin` — Requires `is_super_admin` flag on user (platform-level admin)

### Organization Membership

- Users belong to organizations via `organization_memberships` (many-to-many)
- Roles: `owner`, `admin`, `member`
- Invitations are token-based (UUID), expire after 7 days, sent via email
- New users auto-join if they sign up with an email that has a pending invitation

---

## 7. Database Schema

### Core Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `users` | User accounts | id, email, google_id, microsoft_id, is_super_admin |
| `organizations` | Tenant organizations | id, name, slug, subscription_status, stripe_customer_id, brand_voice, timezone |
| `organization_memberships` | User-org relationships | user_id, organization_id, role |
| `organization_invitations` | Pending invitations | email, token, expires_at |

### Content & AI Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `knowledge_base` | Organization knowledge entries | org_id, title, content, category, tags[], kb_type, is_chunked |
| `kb_chunks` | Chunked KB entries for retrieval | knowledge_base_id, chunk_index, content, embedding (vector) |
| `response_history` | Generated response log | org_id, user_id, inquiry, response, tool, rating, correction |
| `response_templates` | Saved response templates | org_id, name, content, category |
| `response_rules` | Custom response instructions | org_id, rule_text, sort_order, is_active |
| `voice_profiles` | Learned writing style | org_id, tool, profile_text, source_count |
| `conversations` | Ask Lightspeed conversations | org_id, user_id, title, messages (JSONB), summary |

### Compliance Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `compliance_jurisdictions` | Supported jurisdictions | code, name, regulatory_body, entry_count |
| `compliance_knowledge_base` | Verified regulatory entries | jurisdiction_code, category, title, content, original_text, source_url, last_verified_date |
| `compliance_conversations` | Compliance chat history | org_id, jurisdiction_code, messages (JSONB) |

### Shopify Integration Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `shopify_stores` | Connected store credentials | org_id, shop_domain, access_token (encrypted), scopes |
| `shopify_products` | Synced product catalog | shopify_id, title, price, inventory_quantity |
| `shopify_daily_sales` | Aggregated daily sales | store_id, date, revenue_cents, order_count |
| `shopify_top_products` | Pre-computed top products | store_id, product_id, total_revenue_cents |
| `shopify_webhooks` | Registered webhook IDs | store_id, topic, webhook_id |

### Operational Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `usage_logs` | AI generation usage tracking | org_id, user_id, tool, total_tokens, response_time_ms |
| `audit_logs` | Security-sensitive action log | org_id, user_id, action, resource_type, changes (JSONB), ip_address |
| `calendar_events` | Content calendar entries | org_id, title, start_date, recurrence_rule, category |
| `home_base_posts` | Internal communications | org_id, author_id, content, category, scheduled_at |
| `favorites` | User-saved responses | user_id, response_history_id |
| `feedback` | Response ratings | user_id, response_history_id, rating, correction |
| `velocity_snapshots` | Raffle sales velocity data | org_id, snapshot_data (JSONB), 7-day retention |
| `rules_of_play_drafts` | Rules of Play document drafts | org_id, raffle_type, jurisdiction, content, status |
| `shared_prompts` | Team-shared prompt templates | org_id, user_id, title, prompt_text, use_count |

### Key Relationships

```
users ←→ organization_memberships ←→ organizations
organizations → knowledge_base → kb_chunks (with vector embeddings)
organizations → response_history (with ratings/corrections)
organizations → shopify_stores → shopify_products / shopify_daily_sales
organizations → conversations (Ask Lightspeed)
organizations → compliance_conversations → compliance_knowledge_base
organizations → calendar_events
organizations → home_base_posts
```

---

## 8. API Surface

### Authentication (`/api/auth`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/google` | Public | Google OAuth login/signup |
| POST | `/microsoft` | Public | Microsoft OAuth login/signup |
| GET | `/me` | JWT | Get current user + organization |
| POST | `/create-organization` | JWT | Create new organization |

### AI Tools (`/api`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/response-assistant/generate` | JWT | Stream Response Assistant (SSE) |
| POST | `/generate` | JWT | Non-streaming generation |
| POST | `/generate-stream` | JWT | Streaming generation (SSE) |
| POST | `/analyze` | JWT | Insights Engine analysis |
| POST | `/normalize` | JWT | List Normalizer |
| GET | `/calendar-context` | JWT | Calendar context for AI tools |

### Ask Lightspeed (`/api/ask-lightspeed`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/stream` | JWT | Agentic AI with tool use (SSE) |
| POST | `/upload` | JWT | Upload document for analysis |

### Compliance (`/api/compliance`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/jurisdictions` | JWT | List available jurisdictions |
| POST | `/stream` | JWT | Compliance query (SSE) |
| GET | `/conversations` | JWT | List compliance conversations |

### Knowledge Base (`/api/knowledge-base`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/` | JWT | List KB entries (with search) |
| POST | `/` | JWT | Create KB entry |
| PUT | `/:id` | JWT | Update KB entry |
| DELETE | `/:id` | JWT | Delete KB entry |

### Organizations (`/api/organizations`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/:orgId` | JWT+Org | Get organization details |
| PUT | `/:orgId` | JWT+Admin | Update organization |
| POST | `/:orgId/invite` | JWT+Admin | Invite team member |
| POST | `/:orgId/export` | JWT+Org | Export organization data |

### Shopify (`/api/shopify`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/auth` | JWT | Initiate Shopify OAuth |
| GET | `/callback` | Public | Shopify OAuth callback |
| POST | `/webhook` | HMAC | Shopify webhook receiver |
| GET | `/products` | JWT | List synced products |
| GET | `/analytics` | JWT | Get analytics dashboard data |

### Billing (`/api/billing`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/create-checkout-session` | JWT | Create Stripe checkout |
| POST | `/create-portal-session` | JWT | Stripe billing portal |
| GET | `/subscription` | JWT | Current subscription status |
| POST | `/webhook` | Stripe sig | Stripe webhook receiver |

### Additional Resources
| Route Group | Key Operations |
|---|---|
| `/api/response-history` | CRUD + search + export |
| `/api/favorites` | Save/unsave responses |
| `/api/feedback` | Rate responses (thumbs up/down + corrections) |
| `/api/content-templates` | Template CRUD |
| `/api/response-rules` | Response rule CRUD + reordering |
| `/api/conversations` | Ask Lightspeed conversation management |
| `/api/content-calendar` | Calendar event CRUD + recurring events |
| `/api/home-base` | Internal posts CRUD + comments + reactions |
| `/api/rules-of-play` | Rules of Play document generation |
| `/api/shared-prompts` | Team-shared prompt templates |
| `/api/dashboard` | Dashboard analytics + sync triggers |
| `/api/feed-dashboard` | Social media feed aggregation |
| `/api/admin` | Platform admin (super admin only) |

---

## 9. Third-Party Integrations

### Anthropic Claude API
- **Purpose:** Core AI generation for all tools
- **Integration:** Direct HTTP calls to `api.anthropic.com/v1/messages` (both streaming and non-streaming)
- **Authentication:** API key via `x-api-key` header
- **Features used:** Messages API, streaming (SSE), tool_use (function calling), prompt caching (`cache_control`)

### Voyage AI
- **Purpose:** Text embeddings for semantic search over knowledge base
- **Integration:** HTTP calls to `api.voyageai.com/v1/embeddings`
- **Model:** `voyage-3-lite` (512-dimensional vectors)
- **Authentication:** Bearer token
- **Usage:** Document embeddings on KB entry creation; query embeddings on search

### Stripe
- **Purpose:** Subscription billing and payment processing
- **Integration:** Stripe Node.js SDK
- **Webhook events:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`
- **Features:** Checkout sessions, customer portal, subscription management

### Shopify
- **Purpose:** E-commerce analytics and customer context for lottery operators who sell tickets via Shopify
- **Integration:** REST Admin API (version 2025-04), OAuth 2.0 for store connection
- **Webhooks:** 9 topics registered (products/create, products/update, products/delete, orders/create, orders/updated, orders/cancelled, orders/paid, orders/fulfilled, app/uninstalled)
- **Data synced:** Products (local), orders/customers (live API queries), daily sales (aggregated)

### Google OAuth
- **Purpose:** User authentication
- **Integration:** `google-auth-library` for JWT credential verification; fallback to Google userinfo API for access token verification
- **Scopes:** Email, profile

### Microsoft OAuth (MSAL)
- **Purpose:** User authentication (Microsoft 365 / Azure AD accounts)
- **Integration:** `@azure/msal-node` for authorization code exchange; Microsoft Graph API for profile and photo
- **Scopes:** User.Read

### Gmail SMTP
- **Purpose:** Transactional email (invitations, welcome emails, password resets, calendar reminders, digest emails)
- **Integration:** Nodemailer with Gmail SMTP (App Password authentication)

---

## 10. Testing & Quality

### Test Coverage

**Backend unit tests** (Jest) cover 24 test files across three categories:

**Route tests (8 files):**
- `routes/admin` — Admin dashboard endpoints
- `routes/auth` — Authentication flows (Google, Microsoft)
- `routes/askLightspeed` — Agentic AI endpoint integration tests
- `routes/billing` — Stripe billing and subscription management
- `routes/compliance` — Compliance assistant endpoints
- `routes/export` — Data export functionality
- `routes/homeBase` — Internal communications CRUD
- `routes/knowledgeBase` — KB entry management

**Service tests (14 files):**
- `services/auditLog` — Security-sensitive action logging
- `services/budgetAllocator` — Complexity classification and budget allocation
- `services/cache` — TTL-based caching, invalidation, cleanup
- `services/chunkingService` — Text splitting at natural boundaries
- `services/claude` — Anthropic API client, streaming, prompt caching
- `services/compliancePromptBuilder` — Compliance prompt construction and KB-only constraints
- `services/conversationMemory` — Conversation history and cross-tool context
- `services/embeddingService` — Embedding generation and pgvector formatting
- `services/logger` — Structured logging output
- `services/outputValidator` — Prompt leakage, PII detection, format compliance
- `services/promptBuilder` — Context injection orchestrator
- `services/systemPromptBuilder` — Prompt construction and injection detection
- `services/tokenCounter` — Token estimation and budget checking
- `services/voiceFingerprint` — Voice profile analysis and fingerprinting

**Middleware tests (2 files):**
- `middleware/auth` — JWT verification, role-based access control, rate limiting
- `middleware/usageLimit` — Subscription tier enforcement (currently skipped — see audit report)

**Frontend tests:** None. The frontend is vanilla JavaScript without a test framework.

### Linting

- **ESLint** (flat config) runs on backend source code
- CI pipeline allows up to 25 warnings (`--max-warnings 25`)
- No frontend linting in CI

### Code Quality Practices

- Structured logging via custom logger service (timestamp, level, JSON metadata)
- Input validation via `express-validator` on auth and content endpoints
- Prompt injection detection and sanitization
- Post-generation output validation (non-blocking warnings)
- Audit logging for sensitive operations (member invitations, KB deletions, subscription changes)

---

## 11. Known Limitations & Technical Debt

### Architecture

1. **No build step for frontend.** The frontend is served as raw JavaScript files without bundling, minification, or tree-shaking. This means no module system, no TypeScript, no framework — everything is in global scope. While this keeps the stack simple, it limits code organization at scale.

2. **In-memory caching only.** The cache service uses a JavaScript `Map` with TTL expiration. This works for a single-process deployment but will not scale to multiple backend instances without migrating to Redis or a similar distributed cache.

3. **Single-process background jobs.** Calendar reminders, scheduled posts, digest emails, and Shopify analytics sync all run as `setInterval` timers in the main Express process. These should be extracted to a dedicated job runner for reliability and observability.

### Security & Billing

4. **Usage limits are currently bypassed.** The `checkUsageLimit` middleware is hardcoded to `return next()`, meaning all subscription tiers have unlimited AI usage. This must be re-enabled before scaling. (See audit report C-1.)

5. **`new Function()` in List Normalizer.** AI-generated JavaScript is executed in the browser via `new Function()`. This should be sandboxed or replaced with a safe expression evaluator.

### Data & Integration

6. **Ontario-only compliance KB.** The compliance knowledge base currently covers only Ontario's charitable gaming regulations. Expanding to other provinces requires curating and importing additional regulatory data.

7. **No automated KB freshness monitoring.** Compliance KB entries have a `last_verified_date` but there is no automated alerting when entries become stale (>90 days). The stale warning is only shown at response time.

8. **Shopify API version hardcoded.** The Shopify API version (`2025-04`) is hardcoded in multiple files instead of being configurable.

### Testing

9. **No frontend tests.** The 22,000+ line `app.js` has zero test coverage. Critical user flows (authentication, AI generation, data handling) are tested only through manual QA.

10. **Usage limit tests skipped.** The entire `checkUsageLimit` test suite is disabled via `describe.skip()`, meaning there is no automated verification of billing enforcement logic.

11. **CI allows 25 lint warnings.** The ESLint CI check permits up to 25 warnings, which should be reduced to zero.

### Performance

12. **Large monolithic frontend file.** `app.js` is ~22,400 lines. This should be split into modules for maintainability, though it doesn't cause runtime performance issues due to browser caching.

13. **No CDN for static assets.** Frontend assets are served directly from Render's static hosting without a CDN layer. Adding CloudFront or similar would improve global load times.

---

*This document was prepared as part of a production audit and reflects the state of the codebase as of March 2026. All technical claims have been verified through direct code inspection.*
