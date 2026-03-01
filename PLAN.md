# Implementation Plan: Fix All Audit Findings

## Overview

This plan addresses every issue flagged in `RESPONSE_ASSISTANT_AUDIT.md`, organized into 6 phases. Each phase is self-contained and can be deployed independently. Changes are ordered so earlier phases unblock later ones.

**Total scope:** 15 work items across 6 phases.

---

## Phase 1: Extract Shared Logic & Kill Code Duplication (P0)

**Audit finding:** §5.5 — 80+ lines of identical KB/rules/Shopify injection logic copy-pasted between `/generate` and `/generate-stream`.

### 1.1 Create `services/promptBuilder.js`

Extract the shared logic from `routes/tools.js` into a new service:

```
services/promptBuilder.js (NEW)
├── buildEnhancedPrompt(baseSystem, inquiry, organizationId, options)
│   ├── injectResponseRules(system, orgId)      — lines 39-67 of tools.js
│   ├── injectKnowledgeBase(system, inquiry, orgId, kbType) — lines 70-127
│   └── injectShopifyContext(system, inquiry, orgId)        — lines 130-139
└── Returns { system, referencedKbEntries }
```

**Changes:**
- Create `/backend/src/services/promptBuilder.js` with the three helper functions
- Refactor `routes/tools.js` `/generate` endpoint (lines 25-172) to call `buildEnhancedPrompt()`
- Refactor `routes/tools.js` `/generate-stream` endpoint (lines 185-347) to call `buildEnhancedPrompt()`
- Both endpoints shrink to ~30 lines each (auth check → build prompt → call Claude → return)

**Files modified:**
- `backend/src/services/promptBuilder.js` (NEW, ~120 lines)
- `backend/src/routes/tools.js` (refactor, net reduction ~150 lines)

---

## Phase 2: Move Prompt Construction to Backend (P0)

**Audit findings:** §5.2 — System prompt exposed in frontend JavaScript. §4 — Prompt assembled in two locations.

### 2.1 Create backend prompt assembly endpoint

The frontend currently builds the full system prompt (tone, format, org info, draw schedule, language, rated examples, guardrails) in `app.js:7269-7290` and sends it to the backend. We need to move ALL of this server-side.

**New backend endpoint:** `POST /api/build-and-generate-stream`

This endpoint receives only parameters (not the assembled prompt):

```json
{
  "inquiry": "Where are my tickets?",
  "format": "email",
  "tone": 45,
  "length": 60,
  "includeLinks": true,
  "includeSteps": false,
  "agentInstructions": "",
  "staffName": "Sarah",
  "language": "en",
  "tool": "response_assistant"
}
```

The backend then:
1. Looks up organization info (name, website, email, location, licence) from the `organizations` table
2. Looks up draw schedule from `draw_schedules` table
3. Fetches rated examples from `response_history` (moving the `getRatedExamples` logic server-side)
4. Builds the complete system prompt with tone/length/format/language instructions
5. Calls `buildEnhancedPrompt()` from Phase 1 to add rules + KB + Shopify
6. Calls Claude and streams the response

**Changes:**
- Create `/backend/src/services/systemPromptBuilder.js` (NEW) — contains all prompt templates that currently live in `app.js:7269-7290`
- Add new route handler in `routes/tools.js` for the unified endpoint
- Modify `frontend/app.js` `generateCustomResponse()` (lines 7204-7352) to send parameters instead of building the prompt
- Remove `buildRatedExamplesContext()` from frontend (lines 7176-7202)
- Remove `getRatedExamples()` fetch from frontend (lines 7159-7174) — backend handles this internally now
- Keep the existing `/generate-stream` endpoint working for backward compatibility but mark as deprecated

**Files modified:**
- `backend/src/services/systemPromptBuilder.js` (NEW, ~200 lines)
- `backend/src/routes/tools.js` (add new endpoint, ~80 lines)
- `frontend/app.js` (simplify `generateCustomResponse`, remove prompt construction, net reduction ~100 lines)

---

## Phase 3: Security Hardening (P0)

**Audit findings:** §5.1 — Prompt injection. §5.3 — No rate limiting on AI generation. §5.4 — API key management.

### 3.1 Add prompt injection defenses

**Changes to `services/systemPromptBuilder.js`:**
- Wrap all user-provided content in XML delimiters (`<customer_inquiry>`, `<agent_instructions>`) so Claude can distinguish user content from system instructions
- Add input sanitization function that:
  - Strips common injection patterns ("ignore previous instructions", "system prompt", "you are now")
  - Enforces a hard character limit on inquiry text (10,000 chars)
  - Logs sanitized content for monitoring

**Changes to `services/promptBuilder.js`:**
- Add the same XML-delimiter wrapping when injecting KB entries (they could contain user-submitted content from feedback)

### 3.2 Add output validation

**Create `services/outputValidator.js` (NEW):**
- Check generated responses for:
  - System prompt leakage (if response contains prompt template fragments)
  - PII patterns (SSN, credit card numbers, email addresses not in the org profile)
  - Competitor mentions (configurable per org)
- Return validation warnings alongside the response (don't block, but flag)
- Wire into both `/generate` and `/generate-stream` response paths

### 3.3 Add per-user AI generation throttle

**Changes to `middleware/auth.js`:**
- Add `checkAIRateLimit` middleware specifically for generation endpoints
- Limit: 10 generation requests per minute per user (configurable)
- Use in-memory rate tracking (Map with TTL cleanup) — no Redis dependency needed yet

**Files modified:**
- `backend/src/services/systemPromptBuilder.js` (add sanitization + XML delimiters)
- `backend/src/services/promptBuilder.js` (add XML delimiters for KB content)
- `backend/src/services/outputValidator.js` (NEW, ~80 lines)
- `backend/src/middleware/auth.js` (add per-user AI rate limit, ~30 lines)
- `backend/src/routes/tools.js` (wire output validator into response paths)

---

## Phase 4: Database Improvements (P1)

**Audit findings:** §6.1 — KB scaling bottleneck. §6.4 — No caching. §6.5 — Missing indexes.

### 4.1 Add PostgreSQL full-text search for knowledge base

**New migration `022_add_kb_fulltext_search.sql`:**
```sql
-- Add tsvector column
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate from existing data
UPDATE knowledge_base SET search_vector =
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B');

-- GIN index for fast search
CREATE INDEX IF NOT EXISTS idx_knowledge_base_search ON knowledge_base USING GIN(search_vector);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION kb_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER kb_search_vector_trigger
    BEFORE INSERT OR UPDATE ON knowledge_base
    FOR EACH ROW EXECUTE FUNCTION kb_search_vector_update();
```

**Changes to `services/promptBuilder.js`:**
- Before calling Haiku, pre-filter KB entries using full-text search:
  ```sql
  SELECT id, title, content, category, tags, updated_at,
         ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
  FROM knowledge_base
  WHERE organization_id = $1 AND kb_type = $3
    AND search_vector @@ plainto_tsquery('english', $2)
  ORDER BY rank DESC
  LIMIT 30
  ```
- If full-text search returns < 5 results, fall back to loading all entries (handles queries with no good keyword matches)
- Send only the top 30 candidates to Haiku instead of ALL entries
- This scales to 100K+ entries per organization

### 4.2 Add missing database indexes

**New migration `023_add_missing_indexes.sql`:**
```sql
-- Rated examples compound index (used by responseHistory.js rated-examples query)
CREATE INDEX IF NOT EXISTS idx_response_history_rated_examples
    ON response_history (organization_id, tool, format, rating)
    WHERE rating IS NOT NULL;

-- Auth middleware: cache-friendly org membership lookup
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_org
    ON organization_memberships (user_id, organization_id);

-- Usage logs monthly count (used by checkUsageLimit)
CREATE INDEX IF NOT EXISTS idx_usage_logs_org_monthly
    ON usage_logs (organization_id, created_at)
    WHERE created_at >= CURRENT_DATE - INTERVAL '31 days';
```

### 4.3 Add in-memory caching for hot paths

**Create `services/cache.js` (NEW):**
- Simple in-memory cache with TTL (no Redis dependency)
- Cache targets:
  1. **Auth middleware org lookup** — cache `organization_id` by `user_id` for 5 minutes (eliminates 2 DB queries per request)
  2. **KB entries per org** — cache for 2 minutes (KB changes are infrequent)
  3. **Response rules per org** — cache for 2 minutes
  4. **Usage limit count** — cache monthly count for 60 seconds
- Implementation: `Map<string, { value, expiresAt }>` with periodic cleanup

**Files modified/created:**
- `backend/migrations/022_add_kb_fulltext_search.sql` (NEW)
- `backend/migrations/023_add_missing_indexes.sql` (NEW)
- `backend/src/services/cache.js` (NEW, ~60 lines)
- `backend/src/services/promptBuilder.js` (use full-text search pre-filtering)
- `backend/src/middleware/auth.js` (add caching for org lookup and usage limit)
- `backend/src/routes/knowledgeBase.js` (invalidate KB cache on create/update/delete)
- `backend/src/routes/responseRules.js` (invalidate rules cache on create/update/delete)

---

## Phase 5: Robustness & Edge Cases (P1-P2)

**Audit findings:** §5.7 — No error recovery. §5.8 — Empty KB. §5.9 — Multi-part queries. §5.10 — Stale Shopify data. §2 — No token counting. §2 — No chunking.

### 5.1 Add token counting and context window management

**Create `services/tokenCounter.js` (NEW):**
- Use a simple token estimation function (chars / 4 as rough approximation, or integrate `@anthropic-ai/tokenizer` if available)
- Before assembling the final prompt, calculate estimated total tokens
- If approaching the limit (e.g., >150K for Sonnet's 200K window):
  - Reduce number of KB entries
  - Reduce number of rated examples
  - Truncate long KB entries to first 2,000 tokens
- Log a warning to console when prompt exceeds 100K tokens

### 5.2 Add KB entry chunking for large entries

**Changes to `services/promptBuilder.js`:**
- When a KB entry exceeds 3,000 characters, split it into chunks at paragraph boundaries
- Only inject the chunk most relevant to the inquiry (use the full-text search rank)
- Add a `[truncated]` marker so the model knows there's more content

### 5.3 Improve streaming error recovery

**Changes to `routes/tools.js`:**
- On Claude API failure mid-stream, send a structured error event:
  ```json
  {"type": "error", "error": "Generation interrupted", "partial": true, "retry": true}
  ```
- Add the partial response text to the error event so the frontend can display what was generated

**Changes to `frontend/app.js`:**
- On stream error, show the partial response with a "Retry" button instead of leaving the UI broken
- On retry, send the partial response as context so Claude can continue from where it left off

### 5.4 Handle empty knowledge base gracefully

**Changes to `services/systemPromptBuilder.js`:**
- If no KB entries exist for the org, add explicit instruction: "No knowledge base entries are available. Only provide general information and recommend the customer contact support directly."
- Frontend quality check should show a more prominent warning for empty KB

### 5.5 Add Anthropic prompt caching

**Changes to `services/claude.js`:**
- Use Anthropic's `cache_control` feature on the system prompt:
  ```javascript
  system: [{
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" }
  }]
  ```
- This caches the system prompt (including KB entries and rules) across requests within the TTL
- Reduces both cost and latency for repeated similar requests

**Files modified/created:**
- `backend/src/services/tokenCounter.js` (NEW, ~50 lines)
- `backend/src/services/promptBuilder.js` (add chunking, token budget)
- `backend/src/services/systemPromptBuilder.js` (empty KB handling)
- `backend/src/services/claude.js` (add prompt caching support)
- `backend/src/routes/tools.js` (improved error events)
- `frontend/app.js` (retry UI on stream failure, ~30 lines)

---

## Phase 6: Testing & Quality Infrastructure (P2)

**Audit finding:** §Critical Issues #6 — Zero test coverage.

### 6.1 Set up test infrastructure

**Install dev dependencies:**
- `jest` — test runner
- `supertest` — HTTP endpoint testing

**Create test structure:**
```
backend/
├── __tests__/
│   ├── services/
│   │   ├── promptBuilder.test.js
│   │   ├── systemPromptBuilder.test.js
│   │   ├── outputValidator.test.js
│   │   ├── tokenCounter.test.js
│   │   └── cache.test.js
│   ├── routes/
│   │   └── tools.test.js
│   └── middleware/
│       └── auth.test.js
```

### 6.2 Write critical path tests

**Priority tests:**
1. `promptBuilder.test.js` — verify rules injection, KB injection, Shopify injection all work correctly and don't duplicate
2. `systemPromptBuilder.test.js` — verify prompt structure, tone/length mapping, format instructions, language handling
3. `outputValidator.test.js` — verify PII detection, prompt leakage detection
4. `tokenCounter.test.js` — verify token estimation, budget enforcement, truncation
5. `cache.test.js` — verify TTL expiration, invalidation
6. `tools.test.js` — integration tests for `/generate-stream` endpoint (mock Claude API)
7. `auth.test.js` — verify rate limiting, usage limits, org lookup caching

**Files modified/created:**
- `backend/package.json` (add jest + supertest dev dependencies, add `"test"` script)
- `backend/jest.config.js` (NEW)
- `backend/__tests__/` (NEW directory with 7 test files)

---

## Summary: What Gets Fixed

| Audit Finding | Phase | Status |
|--------------|-------|--------|
| §5.5 Code duplication (generate vs generate-stream) | Phase 1 | Fixed — shared `promptBuilder` service |
| §5.2 System prompt exposed in frontend | Phase 2 | Fixed — prompt built server-side |
| §4 Prompt assembled in two locations | Phase 2 | Fixed — single server-side assembly point |
| §5.1 No prompt injection defense | Phase 3 | Fixed — XML delimiters + input sanitization |
| §4 No output validation | Phase 3 | Fixed — PII/leakage/content checks |
| §5.3 No per-user AI rate limiting | Phase 3 | Fixed — 10 req/min per user |
| §6.1 KB loads ALL entries (no pre-filtering) | Phase 4 | Fixed — PostgreSQL full-text search pre-filter |
| §6.5 Missing database indexes | Phase 4 | Fixed — compound indexes for rated examples, auth, usage |
| §6.4 No caching anywhere | Phase 4 | Fixed — in-memory TTL cache for auth, KB, rules, usage |
| §2 No token counting or context management | Phase 5 | Fixed — token budget with automatic truncation |
| §2 No KB entry chunking | Phase 5 | Fixed — auto-chunk entries >3K chars |
| §5.7 No error recovery for failed generation | Phase 5 | Fixed — partial response display + retry |
| §5.8 Empty knowledge base edge case | Phase 5 | Fixed — explicit empty-KB instruction |
| Anthropic prompt caching (cost/latency) | Phase 5 | Fixed — cache_control on system prompt |
| §Critical #6 Zero test coverage | Phase 6 | Fixed — Jest test suite for critical paths |

### Items intentionally deferred (not in this plan)

These are large architectural changes that don't belong in a single PR:

- **Frontend monolith breakup** (§5.6) — requires choosing a framework, complete rewrite
- **Vector embeddings for semantic search** (§7 P3) — requires a vector DB (pgvector or external)
- **A/B testing for prompts** (§7 P3) — requires analytics infrastructure
- **Fine-tuning pipeline** (§7) — requires 1000+ rated examples
- **Redis caching layer** (§7 P1) — in-memory cache is sufficient for current scale
- **KB entry versioning** (§7) — separate feature work
- **Feedback loop effectiveness tracking** (§7) — separate analytics feature

---

## Execution Order

All phases are sequential — each builds on the previous:

1. **Phase 1** first — creates the `promptBuilder` service that Phase 2 depends on
2. **Phase 2** next — moves prompt construction server-side, which Phase 3's sanitization depends on
3. **Phase 3** next — security hardening builds on the server-side prompt assembly
4. **Phase 4** next — database improvements are independent but benefit from the cleaner code structure
5. **Phase 5** next — robustness improvements layer onto the new architecture
6. **Phase 6** last — tests validate all the above changes
