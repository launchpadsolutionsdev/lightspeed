# Test Coverage Plan

**Current State:** 12 test files, ~1.7K LOC, ~8% backend coverage, 0% frontend coverage
**Target State:** 30%+ backend coverage across all critical paths, foundational frontend coverage
**Estimated New Test Files:** 18 | **Estimated New Test LOC:** ~4,500

---

## Guiding Principles

1. **Follow existing patterns** — Jest + Supertest, `jest.mock()` for DB/services, manual req/res/next stubs
2. **No real database** — All tests mock `../../config/database` with `jest.fn()` (pattern established in `usageLimit.test.js`)
3. **No real API calls** — Mock Anthropic, Voyage, Stripe, Shopify SDKs
4. **Test behavior, not implementation** — Assert on responses, side effects, and error codes
5. **Prioritize by risk** — Money, security, and legal compliance first

---

## Phase 1: Critical Fixes (Week 1)
*Re-enable broken tests and close the highest-risk gaps*

### 1.1 Re-enable Usage Limit Tests
**File:** `__tests__/middleware/usageLimit.test.js`
**Work:** Remove `describe.skip()`, fix `checkUsageLimit` to actually enforce limits, verify all 9 existing test cases pass.
**Why:** Billing enforcement is the #1 critical issue. Tests already exist but are disabled because the middleware is bypassed. Fix both together.

### 1.2 NEW: Billing Webhook Tests
**File:** `__tests__/routes/billing.test.js`
**Mock:** Stripe SDK (`stripe.webhooks.constructEvent`), database pool
**Test cases:**
- Valid webhook signature → processes event
- Invalid signature → returns 400
- `customer.subscription.updated` → updates org subscription_status
- `customer.subscription.deleted` → marks org cancelled
- `invoice.payment_failed` → marks org past_due
- Unknown event type → acknowledges without action
- DB error during processing → returns 500, doesn't crash
- Missing Stripe headers → returns 400
**Why:** Money path. Incorrect webhook handling = lost revenue or unauthorized access.

### 1.3 NEW: Auth Middleware — JWT & Organization Tests
**File:** `__tests__/middleware/auth.test.js` (extend existing)
**Mock:** `jsonwebtoken.verify`, database pool
**New test cases for `authenticate`:**
- Valid JWT → attaches user to req, calls next
- Expired JWT → returns 401
- Missing Authorization header → returns 401
- Malformed token → returns 401
- User not found in DB → returns 401
- DB error → returns 500

**New test cases for `requireOrganization`:**
- Valid org + membership → attaches org to req
- Org not found → returns 404
- User not a member → returns 403
- Cached org hit → skips DB query

**New test cases for `requireAdmin` / `requireOwner`:**
- Correct role → calls next
- Insufficient role → returns 403
- Super admin bypass → calls next regardless of role
**Why:** Every authenticated request flows through this middleware. A bug here = platform-wide auth bypass.

---

## Phase 2: Security & Compliance (Week 2)
*Protect the paths where errors have legal or security consequences*

### 2.1 NEW: Compliance Citation Tests
**File:** `__tests__/routes/compliance.test.js`
**Mock:** Database pool, Claude service (`streamResponse`), compliance prompt builder
**Test cases:**
- Org without compliance_enabled → returns 403
- Valid chat request → streams response with citations
- Citation IDs validated against KB → invalid citations flagged
- Freshness calculation: <90 days → current, 90-180 → verify_recommended, >180 → outdated
- Mandatory disclaimer present in every response
- Jurisdiction mismatch mid-conversation → returns error
- New conversation created when no conversationId provided
- Conversation ownership verified (user can't access other user's conversation)
- DB error during citation lookup → graceful error in stream
**Why:** Compliance responses carry legal weight. Wrong citations or missing disclaimers = liability.

### 2.2 NEW: Shopify OAuth & Webhook Security Tests
**File:** `__tests__/routes/shopify.test.js`
**Mock:** Database pool, crypto (HMAC), fetch (Shopify API)
**Test cases for OAuth:**
- Install generates valid redirect URL with correct scopes
- Callback validates HMAC signature → rejects invalid
- Callback exchanges code for access token → stores in DB
- State parameter decoded correctly (org + user info)
- Missing HMAC → returns 400
- Invalid state → returns 400

**Test cases for Webhooks:**
- Valid HMAC signature → processes event
- Invalid HMAC → returns 401
- Missing x-shopify-hmac-sha256 header → returns 401
- Supported topic (orders/create) → delegates to handler
- Unsupported topic → acknowledges silently
**Why:** HMAC validation is the only thing preventing webhook spoofing. OAuth bugs = store data leaks.

### 2.3 NEW: Prompt Injection Tests (expand)
**File:** `__tests__/services/systemPromptBuilder.test.js` (extend existing)
**New test cases:**
- All 7 known injection patterns individually tested
- Combined injection attempts
- Unicode/homoglyph evasion attempts (e.g., "ⅰgnore all prevⅰous ⅰnstructions")
- Nested injection within legitimate text
- XML/HTML tag injection in user content
- Very long input with injection at end (truncation boundary)
**Why:** Prompt injection = full system prompt exposure or behavior override.

---

## Phase 3: Core Business Logic (Weeks 3-4)
*Test the paths users interact with most frequently*

### 3.1 NEW: Knowledge Base CRUD Tests
**File:** `__tests__/routes/knowledgeBase.test.js`
**Mock:** Database pool, chunking service, embedding service, cache
**Test cases:**
- List entries with pagination (page 1, page 2, last page, empty)
- Search with full-text query → returns ranked results
- Search with type/category filters
- Create entry → validates required fields (title, content, category)
- Create entry → deduplicates tags
- Create entry → triggers async chunking (verified mock called)
- Create entry → creates audit log
- Duplicate detection → finds exact title matches
- Duplicate detection → finds prefix matches (first 40 chars)
- Merge entries → keeps target, deletes source, combines tags
- Missing required fields → returns 400 with specific field errors
- Cache invalidation on create/update/delete

### 3.2 NEW: Organization Management Tests
**File:** `__tests__/routes/organizations.test.js`
**Mock:** Database pool, nodemailer
**Test cases:**
- List user's organizations → returns all memberships
- Get org details → returns full org with settings
- Update org → maps camelCase fields to snake_case correctly
- Update org → optimistic concurrency check (conflict detection)
- Update org → concurrent update returns 409
- Update org → creates audit log
- List members → includes active members + pending invites
- Invite member → sends email, creates invitation record
- Invite existing member → returns error
- Invite with invalid email → returns 400

### 3.3 NEW: Claude Service Tests
**File:** `__tests__/services/claude.test.js`
**Mock:** Anthropic SDK, database pool
**Test cases:**
- `generateResponse` → sends correct model/prompt, returns text
- `generateResponse` → handles API error gracefully
- `sanitizeJsonString` → strips lone surrogates
- `sanitizeJsonString` → preserves valid Unicode (emojis, CJK)
- `tagMatchFallback` → scores by direct substring match (+3)
- `tagMatchFallback` → scores by token overlap (+1)
- `tagMatchFallback` → scores by title keyword match (+1)
- `tagMatchFallback` → returns entries sorted by score descending
- `tagMatchFallback` → caps at requested limit
- `pickRelevantKnowledge` → falls back to tagMatchFallback on Haiku failure

### 3.4 NEW: Prompt Builder Tests
**File:** `__tests__/services/promptBuilder.test.js`
**Mock:** Database pool, embedding service, claude service
**Test cases:**
- `injectResponseRules` → formats rules with priority ordering
- `injectResponseRules` → respects token budget
- `injectKnowledgeBase` → tries semantic search first
- `injectKnowledgeBase` → falls back to FTS when semantic returns nothing
- `injectKnowledgeBase` → falls back to tag matching as last resort
- `injectKnowledgeBase` → respects maxKbEntries limit
- Budget allocation integration → simple inquiry gets small context
- Budget allocation integration → complex inquiry gets large context

---

## Phase 4: Integration & Streaming (Weeks 5-6)
*Test the complex async paths*

### 4.1 NEW: Ask Lightspeed Route Tests (expand)
**File:** `__tests__/routes/askLightspeed.test.js` (extend existing)
**Mock:** Claude service, database pool, file parsing libs
**Test cases:**
- Valid text inquiry → streams SSE response
- File upload (PDF) → parses and includes in context
- File upload (Excel) → parses and includes in context
- File upload exceeds 10MB → returns 413
- Unsupported file type → returns 400
- Tool: `search_knowledge_base` → queries DB with FTS
- Tool: `search_knowledge_base` → falls back to ILIKE
- Tool: `create_runway_events` → requires confirmation
- Tool: `save_to_knowledge_base` → requires confirmation
- Missing org context → returns 403
- AI rate limit hit → returns 429

### 4.2 NEW: Home Base Tests
**File:** `__tests__/routes/homeBase.test.js`
**Mock:** Database pool, Claude service
**Test cases:**
- Create post → validates required fields
- List posts → pagination, filters by org
- Search posts → full-text search
- Update post → ownership check (author only)
- Delete post → ownership check or admin
- Pin/unpin post → admin only

### 4.3 NEW: Shopify Analytics Service Tests
**File:** `__tests__/services/shopifyAnalytics.test.js`
**Mock:** fetch (Shopify GraphQL/ShopifyQL API)
**Test cases:**
- `shopifyGraphQL` → sends correct query, returns parsed data
- `shopifyGraphQL` → 30s timeout via AbortController
- `shopifyGraphQL` → handles non-ok response
- `runShopifyQL` → handles TableResponse format
- `runShopifyQL` → handles PolarisVizResponse format
- `runShopifyQL` → throws on ParseError
- `runFullSync` → uses ShopifyQL path when available
- `runFullSync` → falls back to GraphQL when ShopifyQL unavailable

---

## Phase 5: Edge Cases & Hardening (Week 7)
*Fill remaining gaps and add regression tests*

### 5.1 NEW: Export Route Tests
**File:** `__tests__/routes/export.test.js` (extend existing)
**Test cases:** Expand based on current coverage gaps

### 5.2 NEW: Calendar Context Edge Cases
**File:** `__tests__/services/systemPromptBuilder.test.js` (extend)
**Test cases:**
- Recurring daily event expansion (max 20 instances)
- Recurring weekly event with end date
- Recurring monthly event on 31st (short months)
- Events spanning DST transition
- Empty calendar → returns empty context

### 5.3 NEW: Embedding Service Edge Cases
**File:** `__tests__/services/embeddingService.test.js` (extend)
**Test cases:**
- Batch larger than 128 texts → splits correctly
- Empty text array → returns empty
- Missing VOYAGE_API_KEY → graceful degradation
- API error → throws with useful message
- `formatForPgvector` → correct bracket format for pgvector

### 5.4 NEW: Audit & Logging Tests
**File:** `__tests__/services/audit.test.js`
**Test cases:**
- Audit log created with correct fields
- Fire-and-forget doesn't block caller
- DB error in audit doesn't crash caller

---

## Phase 6: Frontend Foundation (Week 8+)
*Establish frontend testing infrastructure — not full coverage, but a foundation*

### 6.1 Setup
- Add Jest + jsdom to frontend (or use Vitest)
- Configure module mocking for `fetch`, `localStorage`
- Extract testable utility functions from `app.js` into modules

### 6.2 Priority Frontend Tests
**Critical security test:**
- Remove or sandbox `new Function()` in List Normalizer (C-2), add test that confirms no dynamic code execution

**Utility function tests:**
- Date formatting helpers
- URL construction
- Input validation/sanitization
- State management helpers

### 6.3 Frontend Refactoring (Prerequisite)
The 21K-line `app.js` needs modularization before meaningful frontend testing is feasible. Recommend extracting into ES modules:
- `auth.js` — Login/logout/token management
- `api.js` — Fetch wrapper with auth headers
- `router.js` — SPA routing
- `tools/*.js` — One module per tool UI

---

## CI/CD Changes

### Immediate (Phase 1)
```yaml
# .github/workflows/ci.yml changes:
- run: npm test -- --coverage --coverageReporters=text-summary
# Add coverage threshold:
- run: npm test -- --coverage --coverageThreshold='{"global":{"branches":20,"functions":25,"lines":25}}'
```

### Phase 3+
```yaml
# Tighten lint threshold
- run: npx eslint src/ --max-warnings 0

# Add coverage badge or report
- uses: codecov/codecov-action@v4
```

---

## Summary by Phase

| Phase | Focus | New Tests | Risk Addressed | Effort |
|-------|-------|-----------|----------------|--------|
| **1** | Critical fixes | 3 files, ~600 LOC | Billing, auth bypass | 1 week |
| **2** | Security & compliance | 3 files, ~500 LOC | Legal liability, webhook spoofing | 1 week |
| **3** | Core business logic | 4 files, ~1,200 LOC | Data integrity, AI quality | 2 weeks |
| **4** | Integration & streaming | 3 files, ~1,000 LOC | Feature reliability | 2 weeks |
| **5** | Edge cases & hardening | 3 files, ~600 LOC | Regression prevention | 1 week |
| **6** | Frontend foundation | 2 files, ~600 LOC | XSS, code injection | 1+ weeks |

### Coverage Progression Target

| Milestone | Backend Coverage | Files |
|-----------|-----------------|-------|
| Current | ~8% | 12 |
| After Phase 1 | ~15% | 15 |
| After Phase 2 | ~20% | 18 |
| After Phase 3 | ~28% | 22 |
| After Phase 4 | ~35% | 25 |
| After Phase 5 | ~40% | 28 |

---

## Test Infrastructure Needed

**No new dependencies required.** The existing Jest + Supertest stack handles everything:
- Unit tests: `jest.mock()` + manual stubs (established pattern)
- HTTP tests: Supertest against Express app
- Streaming tests: Mock `res.write()` / `res.end()` for SSE
- Async tests: Standard `async/await` with mock resolution

**One recommended addition:**
```bash
npm install --save-dev @faker-js/faker  # Realistic test data generation
```

---

## Key Risks to This Plan

1. **Middleware bypass coupling** — Phase 1 requires fixing `checkUsageLimit` code AND tests together. If the business decides to keep limits off, tests stay skipped.
2. **Frontend modularization** — Phase 6 requires refactoring `app.js` before testing is feasible. This is a separate workstream.
3. **Streaming test complexity** — SSE testing (Phase 4) is inherently harder; may need custom test helpers for `text/event-stream` assertions.
4. **Test maintenance** — 4,500 new LOC of tests requires ongoing maintenance as features change. Each phase should include a brief test-writing guide for contributors.
