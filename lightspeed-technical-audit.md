# Lightspeed Technical Audit

**Codebase:** `/home/user/lightspeed`
**Date:** 2026-03-10
**Stack:** Node.js/Express · PostgreSQL · Anthropic API (Claude) · Vanilla JS frontend

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Tool 1: Response Assistant](#tool-1-response-assistant)
3. [Tool 2: Draft Assistant](#tool-2-draft-assistant)
4. [Tool 3: Ask Lightspeed](#tool-3-ask-lightspeed)
5. [Tool 4: Insights Engine](#tool-4-insights-engine)
6. [Tool 5: List Normalizer](#tool-5-list-normalizer)
7. [Tool 6: Rules of Play Generator](#tool-6-rules-of-play-generator)
8. [Cross-Cutting Concerns](#cross-cutting-concerns)
9. [File Inventory](#file-inventory)
10. [End-to-End Data Flow](#end-to-end-data-flow)

---

## Platform Overview

Lightspeed is a full-featured AI productivity suite built for Canadian nonprofits running charitable lotteries. All six tools share the same Anthropic API backend, PostgreSQL database, and streaming infrastructure. The frontend is a single-page application (`frontend/app.js` + `frontend/index.html`); the backend is Express with route-level separation per domain.

**Core shared services:**

| Service | File | Purpose |
|---|---|---|
| Anthropic client | `backend/src/services/claude.js` | All LLM calls + streaming |
| System prompt builder | `backend/src/services/systemPromptBuilder.js` | Response Assistant prompts |
| Enhanced prompt builder | `backend/src/services/promptBuilder.js` | KB + rules + Shopify injection |
| Output validator | `backend/src/services/outputValidator.js` | Safety + format checks |
| Audit logger | `backend/src/services/auditLog.js` | Sensitive-action logging |
| Auth middleware | `backend/src/middleware/auth.js` | JWT validation |

**AI models in use:**

| Model | Role |
|---|---|
| `claude-sonnet-4-6` | Primary generation (all tools) |
| `claude-opus-4-6` | Optional user-selectable (Ask Lightspeed) |
| `claude-haiku-4-5-20251001` | KB relevance filtering, titles, summarisation |

**Streaming protocol:** Server-Sent Events (SSE) with three event types:
- `{"type":"delta","text":"chunk"}` — text chunk
- `{"type":"kb","entries":[...]}` — referenced KB entries
- `{"type":"done","usage":{...}}` — completion + token counts

---

## Tool 1: Response Assistant

### 1. User-Facing Purpose

Generates customer support responses for lottery inquiries. Staff paste a customer question, set tone (formal ↔ friendly slider), length (brief ↔ detailed slider), format (email or Facebook comment), language (EN/FR/ES), and optional staff instructions. The tool produces a complete, brand-consistent response that respects the organisation's KB, response rules, and draw schedule.

### 2. Architecture

**Backend routes (`backend/src/routes/tools.js`):**

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/response-assistant/generate` | Primary streaming endpoint (SSE) |
| `POST` | `/api/generate` | Legacy non-streaming endpoint |
| `POST` | `/api/generate-stream` | Legacy SSE endpoint |

**AI calls:**
- Sonnet 4.6 — response generation (streaming)
- Haiku 4.5 — KB relevance picker, rated-example picker, correction picker (all synchronous pre-flight calls)

**Database tables:**

| Table | Access pattern |
|---|---|
| `organizations` | Brand voice, website, support email, mission |
| `knowledge_base` | Full-text search → Haiku filter → max 8 entries injected |
| `response_rules` | All active rules for org |
| `draw_schedules` | Upcoming draws + early bird deadlines |
| `response_history` | Save generated response; fetch positive/negative rated examples |
| `usage_logs` | Token accounting per user/org |

### 3. Key Files

```
backend/src/routes/tools.js               — endpoint definitions (lines 28–282)
backend/src/services/systemPromptBuilder.js — complete prompt assembly
backend/src/services/promptBuilder.js      — KB + rules + Shopify injection layer
backend/src/services/claude.js             — Anthropic API + streaming + Haiku filters
backend/src/routes/responseHistory.js      — save/rate/retrieve response history
frontend/app.js                            — Response Assistant UI (~lines 7617–8275)
```

### 4. RAG, Semantic Search & Prompt Engineering

**Knowledge base retrieval (3-stage pipeline):**

1. PostgreSQL full-text search — `search_vector @@ plainto_tsquery(inquiry)` on `knowledge_base` table, filtered to `kb_type='support'`, returns up to 30 candidates
2. Tag-match scoring fallback — if FTS returns < 5 results, score by shared tags
3. Haiku relevance filter (`pickRelevantKnowledge()` in `claude.js`) — Haiku reads the 30 candidates and the inquiry, returns indices of the 8 most relevant; total KB budget capped at 30 KB of text

**Rated examples (few-shot learning):**
- Fetches up to 30 positive + 15 negative rated responses from `response_history`
- Haiku filters both sets for topical relevance to the current inquiry
- Returns max 8 positive + 5 negative examples injected as in-context demonstrations

**Corrections (highest-priority override):**
- `fetchRelevantCorrections()` searches all negative-rated responses that have staff feedback text (no recency limit)
- Haiku selects ≤5 corrections matching current inquiry
- Deduplicates by >70% word-overlap similarity
- Injected **before** general rated examples so they take precedence

**Prompt injection defence:**
- `sanitizeInquiry()` strips patterns: `"ignore previous instructions"`, `"reveal prompt"`, `"you are now"`, etc.
- User-supplied text wrapped in XML tags: `<customer_inquiry>`, `<agent_instructions>`, `<email_thread>`
- Max inquiry: 10,000 chars (20,000 for thread mode)
- Prompt assembled server-side only — never exposed in browser

**System prompt structure:**
```
You are a helpful customer support assistant for [Org]…

TONE: [formal/balanced/friendly]
LENGTH: [brief/moderate/detailed]
LANGUAGE: [language instruction]
FORMAT: [email/facebook rules]

ORGANIZATION INFO: name, website, support email, mission

[DRAW SCHEDULE CONTEXT — imminent draws highlighted]

ORGANIZATION RESPONSE RULES (MUST follow):
  1. [rule]  2. [rule]  …

CORRECTIONS FROM PAST FEEDBACK (HIGHEST PRIORITY):
  [≤5 examples: inquiry → feedback → corrected answer]

PREVIOUSLY APPROVED RESPONSES:
  [≤8 positive examples: inquiry → response]

PREVIOUSLY REJECTED RESPONSES:
  [≤5 negative examples: inquiry → feedback → correction]

Knowledge base:
  [≤8 KB entries with source numbers]
  [Citation rules if KB present]
```

**Prompt caching:** System prompt wrapped with `cache_control: { type: "ephemeral" }` — reduces latency and cost on repeated calls with the same org context.

### 5. Input / Output Flow

**User sends:**
```json
{
  "inquiry": "Customer question",
  "format": "email | facebook",
  "tone": 50,
  "length": 50,
  "includeLinks": true,
  "includeSteps": false,
  "agentInstructions": "Optional staff note",
  "staffName": "Support Team",
  "language": "en | fr | es",
  "tool": "response_assistant",
  "isThread": false
}
```

**Backend pipeline:**
1. Fetch org profile
2. Fetch active draw schedule
3. KB pool (FTS) → Haiku filter → 8 entries
4. Rated examples (30+15) → Haiku filter → 8+5
5. Corrections (all negative+feedback) → Haiku filter → 5
6. Assemble system prompt
7. Stream response via Anthropic SSE
8. Validate output (safety + format)
9. Save to `response_history`; log tokens to `usage_logs`

**Claude API call:**
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 200,
  "system": [{"type":"text","text":"[prompt]","cache_control":{"type":"ephemeral"}}],
  "messages": [{"role":"user","content":"<customer_inquiry>…</customer_inquiry>"}],
  "stream": true
}
```
(`max_tokens`: 200 for Facebook, 1024 for email)

**Returns to user:**
- Streamed response text
- Referenced KB entries + citation numbers
- Quality metrics (char count, word count, KB hits, latency)
- Warnings if Facebook response exceeds 400 chars

### 6. Dependencies

| Dependency | Detail |
|---|---|
| Anthropic API | Sonnet 4.6 (generation) + Haiku 4.5 (filtering) |
| PostgreSQL | `organizations`, `knowledge_base`, `response_rules`, `draw_schedules`, `response_history`, `usage_logs` |
| `checkAIRateLimit` | Per-user/org rate limiting middleware |
| `checkUsageLimit` | Trial vs. premium token budget enforcement |

---

## Tool 2: Draft Assistant

### 1. User-Facing Purpose

Generates original content from scratch — marketing emails, social posts, donation solicitations, event announcements, or any freeform content type. Users describe what they want; the tool produces brand-consistent copy informed by the organisation's internal knowledge base and (optionally) its Shopify product catalogue.

### 2. Architecture

**Backend route (`backend/src/routes/tools.js`, lines 516–620):**

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/draft` | Generate draft (non-streaming) |

**AI calls:** Sonnet 4.6 (generation) + Haiku 4.5 (KB relevance filtering)

**Database tables:**

| Table | Access pattern |
|---|---|
| `organizations` | Brand voice, website |
| `knowledge_base` | `kb_type='internal'` only — internal ops context |
| `shopify_stores` | Product catalogue if store is connected |
| `usage_logs` | Token accounting |

### 3. Key Files

```
backend/src/routes/tools.js            — /api/draft endpoint (lines 516–620)
backend/src/services/claude.js         — LLM calls + Haiku KB filter
backend/src/services/shopify.js        — Shopify product context retrieval
frontend/app.js                        — Draft Assistant UI
```

### 4. RAG & Prompt Engineering

- Fetches all `kb_type='internal'` entries for the org
- Haiku filters to 8 most relevant to the prompt topic
- Optional Shopify context: up to 15 products (name, price, description) if store is connected

**System prompt:**
```
You are a professional content writer for [Org].
[Brand voice if set]
[Tone: warm/professional/casual]
[Length: brief/moderate/detailed]

Internal knowledge base:
  [≤8 internal KB entries]

[Shopify product catalogue if applicable]

[Format instruction based on draft type]
```

### 5. Input / Output Flow

**User sends:**
```json
{
  "prompt": "Topic or request",
  "draftType": "email | social_post | announcement | custom",
  "tone": "professional | friendly | casual",
  "length": "short | medium | long",
  "additionalContext": "Optional"
}
```

**Backend pipeline:** fetch org brand voice → fetch internal KB → Haiku filter → optional Shopify context → single Claude call → return full response

**Returns:** Generated content + usage logged to `usage_logs` with `tool='draft_assistant'`

### 6. Dependencies

| Dependency | Detail |
|---|---|
| Anthropic API | Sonnet 4.6 + Haiku 4.5 |
| PostgreSQL | `organizations`, `knowledge_base`, `shopify_stores`, `usage_logs` |
| Shopify API | Optional — product catalogue injection |

---

## Tool 3: Ask Lightspeed

### 1. User-Facing Purpose

A full general-purpose AI chat assistant — the organisation's own Claude. Supports multi-turn conversation, file uploads (images, PDFs, text), model selection (Sonnet vs Opus), tone selection, "Teach Mode" for capturing organisational knowledge, conversation summarisation for long threads, and a sidebar with conversation history and team view.

### 2. Architecture

**Backend routes:**

| Method | Route | File | Description |
|---|---|---|---|
| `POST` | `/api/conversations` | `conversations.js:74` | Create conversation, auto-generate title via Haiku |
| `GET` | `/api/conversations` | `conversations.js:21` | List conversations (personal or team, paginated, searchable) |
| `GET` | `/api/conversations/:id` | `conversations.js:121` | Fetch single conversation with full message history |
| `PUT` | `/api/conversations/:id` | `conversations.js:152` | Update messages, title, tone, archive status |
| `POST` | `/api/conversations/:id/summarize` | `conversations.js:245` | Haiku summarisation of older messages |
| `POST` | `/api/conversations/:id/title` | `conversations.js:322` | Auto-generate short title via Haiku |
| `POST` | `/api/generate-stream` | `tools.js:212` | Streaming generation (shared endpoint) |
| `POST` | `/api/response-history` | `responseHistory.js` | Save each inquiry/response pair |

**AI calls:**
- Sonnet 4.6 (default) or Opus 4.6 (user-selectable) — generation
- Haiku 4.5 — conversation titles, summarisation, KB filtering

**Database tables:**

| Table | Access pattern |
|---|---|
| `conversations` | Full JSONB message history, title, tone, archive status |
| `response_history` | Each turn saved for rating + future few-shot examples |
| `knowledge_base` | Referenced during responses (`kb_type='all'`) |
| `draw_schedules` | Context for lottery-related questions |
| `usage_logs` | Token tracking |

**Schema source:** `backend/migrations/018_conversations_and_collaboration.sql`
- `conversations` — messages (JSONB), title, tone, is_archived, user_id, org_id
- `shared_prompts` — team-accessible saved prompts

### 3. Key Files

```
backend/src/routes/conversations.js    — conversation CRUD + summarise + title
backend/src/routes/responseHistory.js  — per-turn save + rating
backend/src/services/claude.js         — LLM calls
frontend/app.js                        — initAskLightspeedPage(), sendAlsMessage(),
                                         saveAlsConversationToServer(),
                                         loadAlsSidebarContent(), teach mode,
                                         file attachment handling (~line 3010+)
frontend/index.html                    — #askLightspeedApp DOM structure
```

### 4. RAG & Prompt Engineering

**System prompt:**
```
You are Lightspeed AI, a powerful, full-featured AI assistant built by Launchpad Solutions.
You work for [Org].

TONE: [professional/friendly/casual]
[LANGUAGE instruction]

CORE BEHAVIOR:
Respond directly to the user's request. Only ask clarifying questions when genuinely
ambiguous. When in doubt, generate a response and let the user iterate.

TEACH MODE: If the user says "remember that…", "our policy is…", "when someone asks
about X tell them Y" — acknowledge what was learned.

[full capability description — emails, lotteries, data, coding, research, etc.]

[Draw schedule context]
[Rated examples for ask_lightspeed tool]
```

**Conversation context management:**
- Full history sent with every message
- When conversation grows long: Haiku summarises all but the last 6 messages
- Summary prepended as `[Context from earlier in our conversation: …]` with a matching assistant acknowledgement turn
- Keeps token count within model limits

**Teach Mode:**
- `isTeachModeMessage()` detects patterns: `"remember that"`, `"our policy is"`, `"when someone asks about"`, etc.
- On match: AI acknowledges the instruction; frontend offers "Save to Knowledge Base" button
- User confirms → `POST /api/knowledge-base` creates KB entry with tag `source:teach_mode`
- Entry immediately available for future KB injection in all tools

**File handling:**
- Images → base64 → Claude vision content blocks
- PDFs / text files → extracted text → content blocks
- Files shown in chat UI with preview before sending

### 5. Input / Output Flow

**Frontend sends to `/api/generate-stream`:**
```json
{
  "system": "[assembled system prompt]",
  "inquiry": "[latest user message]",
  "kb_type": "all",
  "messages": [
    {"role":"user","content":"First message"},
    {"role":"assistant","content":"First response"},
    {"role":"user","content":"[latest message or vision blocks]"}
  ],
  "max_tokens": 4096,
  "model": "claude-sonnet-4-6 | claude-opus-4-6"
}
```

**Pipeline:**
1. Build system prompt (draw schedule + rated examples)
2. Stream response via SSE
3. Save turn to `response_history` (tool=`ask_lightspeed`)
4. Detect teach mode
5. If teach mode + user confirms → create KB entry
6. Save full conversation to `conversations` table (server-side)
7. Refresh sidebar list

**Returns:** Streaming text → referenced KB entries → conversation persisted server-side

### 6. Dependencies

| Dependency | Detail |
|---|---|
| Anthropic API | Sonnet 4.6 / Opus 4.6 (generation) + Haiku 4.5 (titles, summaries) |
| PostgreSQL | `conversations`, `response_history`, `knowledge_base`, `draw_schedules`, `usage_logs` |
| Teach Mode → KB API | `POST /api/knowledge-base` on user confirmation |

---

## Tool 4: Insights Engine

### 1. User-Facing Purpose

Analyses uploaded spreadsheet data (CSV, Excel, JSON) and returns actionable business insights. Covers customer purchase analysis, seller/staff performance, payment ticket status, and Shopify store metrics. A secondary path fetches Shopify data directly without requiring a file upload.

### 2. Architecture

**Backend routes (`backend/src/routes/tools.js`):**

| Method | Route | Lines | Description |
|---|---|---|---|
| `POST` | `/api/analyze` | 288–396 | Analyse uploaded data (non-streaming) |
| `GET` | `/api/tools/shopify-analytics` | 626–661 | Pull Shopify analytics directly |

**AI calls:** Sonnet 4.6 (single non-streaming call)

**Database tables:**

| Table | Access pattern |
|---|---|
| `organizations` | Brand voice injection |
| `shopify_stores` | Connected store credentials for direct analytics pull |
| `usage_logs` | Token accounting |

### 3. Key Files

```
backend/src/routes/tools.js     — /api/analyze + /api/tools/shopify-analytics
backend/src/services/shopify.js — Shopify analytics retrieval
frontend/app.js                 — Data Analysis tab UI, file upload, results display
```

### 4. RAG & Prompt Engineering

No KB retrieval. Prompt template selected by `reportType`:

| `reportType` | Prompt requests |
|---|---|
| `customer_purchases` | Key metrics, trends, top customers, recommendations |
| `sellers` | Top performers, underperformers, support recommendations |
| `payment_tickets` | Status overview, outstanding issues, follow-up recommendations |
| `shopify` | Revenue, top products, customer acquisition/retention, fulfilment, refund rate, recommendations |
| `custom` / default | Generic: "Analyse this data and provide insights and recommendations" |

Organisation brand voice prepended if set. Full data injected as `JSON.stringify(data)` directly into the user message.

### 5. Input / Output Flow

**User sends:**
```json
{
  "data": "[JSON array or CSV string]",
  "reportType": "customer_purchases | sellers | payment_tickets | shopify | custom",
  "additionalContext": "Optional"
}
```

**Pipeline:** Select prompt template → append stringified data → single Claude call → return analysis text

**Returns:** Analysis text + saved to `usage_logs` with `tool='insights_engine'`

### 6. Dependencies

| Dependency | Detail |
|---|---|
| Anthropic API | Sonnet 4.6 |
| PostgreSQL | `organizations`, `shopify_stores`, `usage_logs` |
| Shopify API | Optional — direct analytics pull |

---

## Tool 5: List Normalizer

### 1. User-Facing Purpose

Cleans, deduplicates, and transforms spreadsheet data. Users upload CSV/Excel or paste raw data, then optionally provide natural-language transformation rules. The tool supports three modes: simple normalisation (clean + standardise), JSON transform (return cleaned array), and Transform Mode (AI generates a JavaScript function that the browser runs client-side against every row).

### 2. Architecture

**Backend routes (`backend/src/routes/tools.js`):**

| Method | Route | Lines | Description |
|---|---|---|---|
| `POST` | `/api/normalize` | 402–485 | Normalise / transform data |
| `POST` | `/api/normalize/log` | 491–510 | Log client-side usage (no tokens charged) |

**AI calls:** Sonnet 4.6 (single non-streaming call)

**Database tables:** `usage_logs` only

### 3. Key Files

```
backend/src/routes/tools.js  — /api/normalize + /api/normalize/log
frontend/app.js              — List Normalizer UI, file upload, client-side JS execution,
                               deduplication, CSV export
```

### 4. RAG & Prompt Engineering

No KB retrieval. Prompt depends on `outputFormat`:

**Transform Mode system prompt (generates runnable JS):**
```
You are a data transformation expert. You receive sample rows from a spreadsheet
(as JSON) and user instructions.

Your job is to return ONLY a JavaScript function body that transforms a single row.
The function receives `row` (object, keys = column names) and must return:
  - A new object with the desired output columns, OR
  - null to exclude that row

Rules:
- Return ONLY the raw function body — no `function` keyword, no markdown, no explanation
- Plain JavaScript only (no imports, no async, no DOM)
- Column name keys are EXACTLY as in the sample — use those exact keys
- Handle missing/null values gracefully with || ''

Example (combine names, keep email, drop rows without email):
  const firstName = (row['First Name'] || '').toString().trim();
  const lastName  = (row['Last Name']  || '').toString().trim();
  const email     = (row['Email']      || '').toString().trim();
  if (!email) return null;
  return { 'Full Name': (firstName + ' ' + lastName).trim(), 'Email': email.toLowerCase() };
```

**JSON Mode system prompt:**
```
You are a data transformation expert. You receive spreadsheet data as a JSON array
and user instructions. Apply the transformations and return ONLY a valid JSON array
— no markdown fences, no explanation, no extra text.
```

### 5. Input / Output Flow

**User sends:**
```json
{
  "data": "[CSV string or JSON array]",
  "outputFormat": "json | transform | [other]",
  "instructions": "Combine first and last name, lowercase email…"
}
```

**Pipeline:**
- **Transform mode:** Claude returns JS function body → frontend executes it against every row using `new Function(...)` → deduplication → CSV export → `POST /api/normalize/log`
- **JSON mode:** Claude applies transformations and returns cleaned JSON array directly
- **Other formats:** Claude cleans and normalises inline

**Returns:** Transformed data (JS function body, JSON array, or plain text) + client-side processing

### 6. Dependencies

| Dependency | Detail |
|---|---|
| Anthropic API | Sonnet 4.6 |
| PostgreSQL | `usage_logs` only |

---

## Tool 6: Rules of Play Generator

### 1. User-Facing Purpose

Generates complete, submission-ready Rules of Play (ROP) legal documents for charitable lotteries. Users choose a raffle type (50/50, Catch The Ace, Prize Raffle, House Lottery), select a jurisdiction, fill in a multi-step form (organisation name, licence number, ticket pricing, draw schedule, prize details), optionally upload a reference ROP document, and receive a professionally drafted document compliant with that jurisdiction's regulations. Supports export to `.doc`.

### 2. Architecture

**Backend routes (`backend/src/routes/rulesOfPlay.js`):**

| Method | Route | Lines | Description |
|---|---|---|---|
| `GET` | `/api/rules-of-play` | 46–66 | List drafts for org |
| `POST` | `/api/rules-of-play` | 72–100 | Create draft |
| `GET` | `/api/rules-of-play/:id` | 106–128 | Get draft + joined jurisdiction data |
| `PUT` | `/api/rules-of-play/:id` | 134–168 | Update draft (form data, generated document) |
| `DELETE` | `/api/rules-of-play/:id` | 174–190 | Delete draft |
| `POST` | `/api/rules-of-play/:id/generate` | 196–273 | Generate document via AI |
| `POST` | `/api/rules-of-play/:id/upload-reference` | 279–322 | Upload .docx/.pdf reference; extract text |
| `POST` | `/api/rules-of-play/:id/export` | 328–401 | Export to .doc (HTML-wrapped) |

**AI calls:** Sonnet 4.6 (single non-streaming call for document generation)

**Database tables:**

| Table | Access pattern |
|---|---|
| `rules_of_play_drafts` | Draft storage: form_data (JSONB), generated_document, reference_document_text |
| `jurisdictions` | Regulatory data: province, min age, regulatory body, responsible gambling info, geographic restrictions, unclaimed prize rules |
| `usage_logs` | Token accounting |

**Schema source:** `backend/migrations/017_rules_of_play.sql`

### 3. Key Files

```
backend/src/routes/rulesOfPlay.js       — all ROP endpoints
backend/src/services/ropTemplates.js    — TEMPLATE_5050, TEMPLATE_CATCH_THE_ACE,
                                          TEMPLATE_PRIZE_RAFFLE, TEMPLATE_HOUSE_LOTTERY,
                                          buildSystemPrompt()
frontend/app.js                         — initRulesOfPlay(), multi-step form state
frontend/index.html                     — #rulesOfPlayApp DOM
```

**Third-party library:** `mammoth` — DOCX → plain text extraction for reference documents

### 4. RAG & Prompt Engineering

No live KB retrieval. Instead, three static context layers are combined by `buildSystemPrompt()` in `ropTemplates.js`:

**Layer 1 — Reference template** (raffle-type-specific document scaffold)
- Sections: Eligibility, Ticket Sales, Draw Schedule, Prize Details, Ineligible Persons, Winner Notification, Unclaimed Prizes, etc.
- Uses `[PLACEHOLDER_NAME]` format for variable fields

**Layer 2 — Jurisdiction data** (regulatory requirements, fetched from `jurisdictions` table)
```
Province: Ontario
Minimum age: 18
Regulatory body: Alcohol and Gaming Commission of Ontario (AGCO)
Responsible gambling: ConnexOntario — 1-866-531-2600
Geographic restriction: Purchasers must be physically located within Ontario
Unclaimed prize rule: Donated to charity with AGCO approval
```

**Layer 3 — Form data** (organisation-specific, from `form_data` JSONB column)
- Organisation legal name, licence number, raffle brand name
- Draw dates, early bird schedule, ticket pricing tiers
- Prize descriptions, guaranteed minimums, contact information

**Optional Layer 4 — Reference document text** (if user uploaded a sample ROP)
- Extracted via Mammoth (DOCX) or binary text parsing (PDF)
- Provides style/format guidance

**Final system prompt structure:**
```
You are a legal document generator specialising in lottery and raffle regulations
for Canadian nonprofits, particularly Ontario organisations.

Generate a complete, submission-ready Rules of Play document for a [raffle type].
Your output must strictly comply with [jurisdiction] gaming regulations and the
requirements of [Regulatory Body].

[Reference template — structure + placeholders]

[Jurisdiction data]

[Form data — all org/event specifics]

[Reference document text if provided]

Generate a professional, complete, submission-ready document.
```

**User message:**
```
Generate a complete Rules of Play document for this [raffle type] raffle.
Use all the organisation details and form data provided in the system context.
```

### 5. Input / Output Flow

**User flow:**
1. Select raffle type → choose jurisdiction → create draft
2. Fill multi-step form (org details, dates, pricing, prizes)
3. Optionally upload reference `.docx`/`.pdf`
4. Click Generate → backend assembles prompt → Claude call → saved to DB
5. Optionally edit generated text in-browser
6. Export to `.doc`

**Backend at `/api/rules-of-play/:id/generate`:**
```
DB lookup → draft + form_data + jurisdiction + reference_document_text
→ buildSystemPrompt() → single Claude call (max_tokens: ~4000)
→ save generated_document to rules_of_play_drafts
→ return text to frontend
```

**Export (`/api/rules-of-play/:id/export`):**
- Converts plain text to HTML (headers detected by ALL CAPS / Title Case lines, lists by `•`/`-` prefixes)
- Returned as `Content-Type: application/msword` with `.doc` extension

### 6. Dependencies

| Dependency | Detail |
|---|---|
| Anthropic API | Sonnet 4.6 |
| PostgreSQL | `rules_of_play_drafts`, `jurisdictions`, `usage_logs` |
| `mammoth` | DOCX → plain text extraction |
| `multer` | File upload handling (memory storage, 10 MB limit) |

---

## Cross-Cutting Concerns

### Authentication & Authorisation
- Middleware: `backend/src/middleware/auth.js`
- JWT validation on all protected routes; `req.userId` extracted
- Organisation membership resolved via `organization_memberships` table
- Role-based access (owner / admin / member) enforced on billing + admin routes

### Rate Limiting
- Global: 60 requests/minute per IP
- Auth endpoints: 20 requests/15 minutes per IP
- Per-user AI rate limits enforced by `checkAIRateLimit` middleware
- Subscription limits enforced by `checkUsageLimit` (trial: ~100 K tokens/month)

### Prompt Caching
- Anthropic Prompt Caching (`cache_control: { type: "ephemeral" }`) applied to system prompts
- Most effective on Response Assistant where org context repeats across calls
- Reduces both latency and cost

### File Upload Handling (shared across tools)
- `multer` with memory storage — no disk writes
- 10 MB per-file limit
- Images (PNG, JPG) → base64 → Claude vision blocks
- DOCX → Mammoth.js text extraction
- PDF → limited binary text extraction
- CSV/JSON → string parsing in-memory

### Database
- Engine: PostgreSQL 12+
- Connection via `pg` connection pool
- Migrations auto-run on startup from `backend/migrations/`
- Full-text search via `tsvector` / `plainto_tsquery` (knowledge_base table)
- Conversations and form data stored as JSONB

### Environment Variables Required
```
DATABASE_URL          postgresql://user:pass@host/db
JWT_SECRET            signing secret for auth tokens
ANTHROPIC_API_KEY     sk-ant-…
GOOGLE_CLIENT_ID      OAuth client ID
ANTHROPIC_MODEL       claude-sonnet-4-6 (optional override)
SMTP_HOST             outbound mail server
SMTP_USER / SMTP_PASS mail credentials
STRIPE_API_KEY        subscription billing
SHOPIFY_API_KEY       optional Shopify integration
```

---

## File Inventory

| File | Purpose | Tools |
|---|---|---|
| `backend/src/routes/tools.js` | Response Assistant, Draft, Insights, Normalize endpoints | 1, 2, 4, 5 |
| `backend/src/routes/rulesOfPlay.js` | Rules of Play CRUD + generation + export | 6 |
| `backend/src/routes/responseHistory.js` | Save / rate / retrieve response history + stats | 1, 2, 3 |
| `backend/src/routes/conversations.js` | Conversation CRUD + summarise + auto-title | 3 |
| `backend/src/services/systemPromptBuilder.js` | Response Assistant full prompt assembly | 1 |
| `backend/src/services/promptBuilder.js` | KB + rules + Shopify injection layer | 1, 2, 4 |
| `backend/src/services/claude.js` | Anthropic API client, streaming, Haiku filters | 1–6 |
| `backend/src/services/ropTemplates.js` | ROP document templates + buildSystemPrompt() | 6 |
| `backend/src/services/shopify.js` | Shopify API integration | 2, 4 |
| `backend/src/services/outputValidator.js` | Safety + format output validation | 1 |
| `backend/src/services/auditLog.js` | Sensitive-action audit trail | all |
| `backend/src/middleware/auth.js` | JWT validation + org membership | all |
| `backend/migrations/017_rules_of_play.sql` | ROP drafts + jurisdictions schema | 6 |
| `backend/migrations/018_conversations_and_collaboration.sql` | Conversations + shared prompts schema | 3 |
| `frontend/app.js` | All tool UIs, streaming renderer, teach mode, file handling | 1–6 |
| `frontend/index.html` | HTML shell for all tools | 1–6 |

---

## End-to-End Data Flow

```
User Input (browser)
        │
        ▼
frontend/app.js
  ├─ Validate + collect parameters
  ├─ Build attachments / encode files
  └─ POST to backend route
        │
        ▼
Backend Route (tools.js / conversations.js / rulesOfPlay.js)
  ├─ Auth middleware (JWT → userId)
  ├─ Rate limit + usage limit check
  ├─ Fetch org config (brand voice, website, mission)
  ├─ Fetch draw schedule (if applicable)
  ├─ KB retrieval pipeline (if applicable)
  │     ├─ PostgreSQL FTS → ≤30 candidates
  │     └─ Haiku relevance filter → ≤8 injected entries
  ├─ Rated examples pipeline (if applicable)
  │     ├─ Fetch 30 positive + 15 negative from response_history
  │     └─ Haiku filter → ≤8 positive + ≤5 negative
  ├─ Corrections pipeline (if applicable)
  │     ├─ All negative-rated with feedback
  │     └─ Haiku filter → ≤5 corrections
  ├─ Fetch response rules / Shopify context (if applicable)
  └─ Assemble system prompt (systemPromptBuilder / promptBuilder / ropTemplates)
        │
        ▼
Anthropic API
  ├─ model: claude-sonnet-4-6 (or opus-4-6 / haiku-4-5)
  ├─ system: [assembled prompt, cache_control: ephemeral]
  ├─ messages: [user message + history]
  └─ stream: true (SSE) or false
        │
        ▼
Streaming Response (SSE) → frontend renderer
  ├─ delta events → smooth character reveal + gradient fade-in
  ├─ kb events    → citation display
  └─ done event   → flush + show action buttons
        │
        ▼
Post-Processing
  ├─ Output validation (safety, format limits)
  ├─ Save to response_history (tool-tagged)
  ├─ Log tokens to usage_logs
  ├─ Save conversation to conversations table (Ask Lightspeed)
  ├─ Detect teach mode → offer KB save (Ask Lightspeed)
  └─ Return quality metrics (latency, KB hits, char/word count)
        │
        ▼
User sees: generated text + KB citations + rating UI + action buttons
```
