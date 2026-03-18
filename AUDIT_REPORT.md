# Lightspeed Codebase Audit Report

**Audit Date:** 2026-03-18
**Auditor:** Automated code analysis (Claude)
**Scope:** Full backend (Node.js/Express) and frontend (vanilla JS) codebase
**Repository:** launchpadsolutionsdev/lightspeed

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 12 |
| Medium | 22 |
| Low | 15 |
| Cosmetic | 8 |
| **Total** | **60** |

---

## Critical

### C-1: Usage Limits Permanently Bypassed

- **File:** `backend/src/middleware/auth.js:153-156`
- **Description:** The `checkUsageLimit` middleware is hardcoded to `return next()`, bypassing all subscription tier usage enforcement. The comment reads "TEMPORARY" but this is deployed to production.
- **Impact:** Users on trial, past-due, or cancelled subscriptions can generate unlimited AI responses, incurring unbounded Anthropic API costs.
- **Recommended Fix:** Re-enable the usage limit enforcement logic. The `USAGE_LIMITS` object and tier-checking code should be restored. The related test suite at `backend/__tests__/middleware/usageLimit.test.js:26` is also skipped via `describe.skip()` and must be re-enabled in parallel.

### C-2: Dynamic Code Execution from AI Output

- **File:** `frontend/app.js:14254`
- **Description:** The List Normalizer tool uses `new Function('row', aiText)` to execute AI-generated JavaScript transform functions. Although there is a test execution guard, this creates a code injection vector — the AI model's output is executed as arbitrary JavaScript in the user's browser.
- **Impact:** If an attacker crafts input that causes the AI to generate malicious code, it executes in the user's session with full DOM access.
- **Recommended Fix:** Replace `new Function()` with a sandboxed evaluation approach (e.g., Web Worker with restricted scope, or a safe expression evaluator like JSONata). At minimum, wrap execution in a try-catch and add Content-Security-Policy headers that restrict `unsafe-eval`.

### C-3: Usage Limit Test Suite Disabled

- **File:** `backend/__tests__/middleware/usageLimit.test.js:26`
- **Description:** The entire `checkUsageLimit` test suite is disabled with `describe.skip()`. Combined with C-1, this means the billing enforcement path has zero test coverage and is not running.
- **Impact:** Re-enabling usage limits without tests risks introducing billing bugs that could block paying customers or fail to limit non-paying ones.
- **Recommended Fix:** Remove `.skip` and ensure all tests pass before re-enabling the middleware.

---

## High

### H-1: Inconsistent `console.log` / `console.error` in Production

- **Files:** Throughout backend and frontend
- **Backend:** `backend/config/database.js:15,19`, `backend/src/index.js:204,210,216,223,228,231`, `backend/src/services/claude.js:72,229,239,255,311,323,350,420`, `backend/src/services/email.js:29,30,44,45,58,62,63`, `backend/src/services/embeddingService.js:24,52`, `backend/src/services/voiceFingerprint.js:45`
- **Frontend:** `frontend/app.js` (120+ instances), `frontend/admin-dashboard.js`, `frontend/shopify-dashboard.js`, `frontend/compliance.js`
- **Description:** Production code uses raw `console.log` / `console.warn` / `console.error` extensively instead of the structured logger (`services/logger.js`). Backend has a proper logger but it's inconsistently used. Frontend has no conditional logging — all debug output ships to users' browser consoles.
- **Impact:** Information leakage (API errors, email addresses, internal state visible in browser DevTools), inconsistent log aggregation in production, and performance overhead.
- **Recommended Fix:** Replace all backend `console.*` calls with the structured `log.*` logger. For frontend, implement a conditional logging wrapper that suppresses output in production.

### H-2: Hardcoded Model Identifiers

- **Files:** `backend/src/services/claude.js:8`, `backend/src/services/voiceFingerprint.js:14`, `backend/src/services/tokenCounter.js:10-13`
- **Description:** The Haiku model ID (`claude-haiku-4-5-20251001`) is hardcoded in multiple files instead of being sourced from an environment variable.
- **Impact:** Updating model versions requires code changes and redeployment instead of a configuration change. Risk of version drift between files.
- **Recommended Fix:** Add `HAIKU_MODEL` to `.env.example` and source from `process.env.HAIKU_MODEL || 'claude-haiku-4-5-20251001'` in a single shared constant.

### H-3: Hardcoded Shopify API Version

- **Files:** `backend/src/services/shopify.js:9,62`, `backend/src/services/shopifyAnalytics.js:15`
- **Description:** Shopify API version `'2025-04'` is hardcoded in multiple files.
- **Recommended Fix:** Source from `process.env.SHOPIFY_API_VERSION || '2025-04'`.

### H-4: Duplicated `cleanShopDomain()` Function

- **Files:** `backend/src/services/shopify.js:11`, `backend/src/services/shopifyAnalytics.js:22`
- **Description:** The `cleanShopDomain()` utility function is duplicated identically in two files. Any fix to one must be manually replicated to the other.
- **Recommended Fix:** Extract to a shared utility module (e.g., `services/shopifyUtils.js`).

### H-5: Missing Null Check on Embedding Results

- **File:** `backend/src/services/chunkingService.js:117-131`
- **Description:** `generateEmbeddings()` can return `null` (when `VOYAGE_API_KEY` is missing or API fails), but the chunking service passes the result directly to `formatForPgvector()` without null checking. This will crash at runtime.
- **Recommended Fix:** Add null guard before iterating embeddings.

### H-6: Race Condition in Shopify Analytics Cache

- **File:** `backend/src/services/shopify.js:259-374`
- **Description:** The in-memory `_analyticsCache` has no locking mechanism. Concurrent requests for the same cache key can trigger duplicate Shopify API calls before the first one completes.
- **Recommended Fix:** Implement a "pending promise" pattern where concurrent callers await the same in-flight request.

### H-7: Missing Transaction Wrapping for Product Sync

- **File:** `backend/src/services/shopify.js:160-193`
- **Description:** `syncProducts()` deletes existing products and re-inserts from Shopify API without a database transaction. If the insertion fails after deletion, the database is left in an inconsistent state with no products.
- **Recommended Fix:** Wrap the delete + insert in a `BEGIN/COMMIT/ROLLBACK` transaction.

### H-8: Sort Order Race Condition

- **File:** `backend/src/routes/responseRules.js:66-75`
- **Description:** New rule sort order is calculated as `MAX(sort_order) + 1` in a SELECT, then used in a separate INSERT. Concurrent requests can produce duplicate sort orders.
- **Recommended Fix:** Use a database-level default (e.g., `COALESCE(MAX(sort_order), 0) + 1` in a single INSERT…SELECT statement, or use a SERIAL column).

### H-9: Silent Error Swallowing in Frontend

- **Files:** `frontend/admin-dashboard.js:712,716`, `frontend/shopify-dashboard.js:634`, `frontend/app.js:2206,3932,5194,16281,19192`
- **Description:** Multiple `.catch(() => {})` and `catch (e) {}` blocks silently swallow errors with no logging or user notification.
- **Impact:** Bugs and failures are invisible, making production debugging nearly impossible.
- **Recommended Fix:** Replace empty catch blocks with `console.warn()` at minimum, or display user-facing error notifications.

### H-10: Missing Security Headers on Frontend

- **File:** `frontend/render-static.yaml:10-13`
- **Description:** Only `X-Frame-Options: DENY` is configured. Missing critical security headers:
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy` (especially important given `new Function()` usage)
  - `Strict-Transport-Security` (HSTS)
  - `Referrer-Policy`
- **Recommended Fix:** Add all recommended security headers to the static site configuration.

### H-11: Unhandled JSON Parse in Compliance SSE Stream

- **File:** `frontend/compliance.js:282`
- **Description:** `JSON.parse(jsonStr)` is called on SSE stream data without try-catch. Malformed JSON from the server will crash the entire compliance tool.
- **Recommended Fix:** Wrap in try-catch with graceful error handling.

### H-12: Duplicate Migration File Numbers

- **Files:** `backend/migrations/049_shopify_webhooks.sql`, `backend/migrations/049_update_kb_verified_date.sql`, `backend/migrations/052_add_sessions_column.sql`, `backend/migrations/052_enable_compliance_all_orgs.sql`
- **Description:** Migration files 049 and 052 each have two files with the same numeric prefix. Migration execution order is non-deterministic for same-prefixed files.
- **Recommended Fix:** Renumber to ensure unique ordering.

---

## Medium

### M-1: Hardcoded Production URLs

- **Files:** `frontend/app.js:59-61`, `frontend/shopify-dashboard.js:9-13`, `backend/src/routes/organizations.js:15`, `render.yaml:25`
- **Description:** Production backend URL (`lightspeed-backend.onrender.com`) and frontend URL (`lightspeedutility.ca`) are hardcoded in multiple locations rather than being centrally configured.
- **Recommended Fix:** Use a single config source; for frontend, inject API URL via build-time config or `<meta>` tag.

### M-2: Audit Log Fire-and-Forget with No Retry

- **File:** `backend/src/services/auditLog.js:24-30`
- **Description:** Audit log insertions catch errors silently. If the audit table has issues, compliance-relevant actions are lost with no secondary logging or retry.
- **Recommended Fix:** Log failures to stderr as a minimum fallback.

### M-3: Email Recipient Not Validated

- **File:** `backend/src/services/email.js:41`
- **Description:** The `to` parameter is not validated for email format before sending. Null, empty, or malformed addresses pass through to nodemailer.
- **Recommended Fix:** Add basic email format validation before sending.

### M-4: Inconsistent Error Response Formats

- **Files:** Throughout `backend/src/routes/`
- **Description:** Different routes return errors in different formats: `{ error: 'message' }`, `{ success: false, message: '...' }`, `{ deleted: true }`. No standard error envelope.
- **Recommended Fix:** Define and enforce a standard error response shape (e.g., `{ error: { code: string, message: string } }`).

### M-5: Missing Input Validation on Enum Fields

- **Files:** `backend/src/routes/tools.js:42-50`, `backend/src/routes/contentTemplates.js:175-177`, `backend/src/routes/sharedPrompts.js:67`
- **Description:** Fields like `format`, `tone`, and `category` are accepted without validation against allowed values.
- **Recommended Fix:** Add validation against explicit allowed-value lists.

### M-6: No Frontend Test Coverage

- **File:** `.github/workflows/ci.yml`
- **Description:** CI pipeline only runs backend tests and linting. Frontend JavaScript has no tests, no linting, and no type checking.
- **Recommended Fix:** Add frontend linting (ESLint) to CI pipeline at minimum.

### M-7: ESLint Max Warnings Set to 25

- **File:** `.github/workflows/ci.yml:54`
- **Description:** `npx eslint src/ --max-warnings 25` allows up to 25 lint warnings. This should be zero for a production codebase.
- **Recommended Fix:** Gradually reduce `--max-warnings` to 0 by fixing existing warnings.

### M-8: `fs`/`path` Re-imported Inside Functions

- **File:** `backend/src/index.js:247-248,274-275`
- **Description:** `fs` and `path` are `require()`'d inside `runMigrations()` and the seeding block instead of at the top level. The seeding block uses `fs2`/`path2` variable names, indicating copy-paste code.
- **Recommended Fix:** Move requires to the top of the file; remove the `fs2`/`path2` aliasing.

### M-9: Ontario-Only Entry Count Update

- **File:** `backend/src/index.js:309-316`
- **Description:** After seeding compliance KB entries for all jurisdictions, only Ontario's (`'ON'`) entry count is updated. Other jurisdictions' counts remain stale.
- **Recommended Fix:** Loop through all seeded jurisdictions and update their counts.

### M-10: Invitation Token in Plaintext URL

- **File:** `backend/src/routes/organizations.js:237-247`
- **Description:** Organization invitation tokens are plain UUIDs sent in URL query parameters. The 7-day expiration is hardcoded with no rotation strategy.
- **Recommended Fix:** Use signed tokens (JWT or HMAC) for invitations. Make expiration configurable.

### M-11: CORS Allows All Origins in Non-Production

- **File:** `backend/src/index.js:80-84`
- **Description:** When `NODE_ENV !== 'production'`, all origins are allowed without restriction (line 84: `return callback(null, true)`).
- **Impact:** Low in staging but could be exploited if non-production environments contain real data.

### M-12: Missing Pagination on Large Exports

- **File:** `backend/src/routes/export.js:66`
- **Description:** Response history export has a hard limit of 10,000 entries with no pagination. Large exports may timeout.
- **Recommended Fix:** Implement cursor-based pagination or streaming.

### M-13: Date/Timezone Inconsistencies

- **Files:** `backend/src/routes/contentCalendar.js:20-61`, `backend/src/routes/dashboard.js:34-40`
- **Description:** Calendar event expansion uses JavaScript `Date` (timezone-unaware). Dashboard uses `Intl.DateTimeFormat` but falls back to UTC rather than the organization's configured timezone.
- **Recommended Fix:** Standardize on UTC for storage, organization timezone for display logic.

### M-14: Unescaped Variable in Admin Dashboard onclick

- **File:** `frontend/admin-dashboard.js:141`
- **Description:** Template literal `onclick="loadAdminTab('${tab}')"` does not escape the `tab` variable. Special characters could break the handler or enable DOM-based XSS.
- **Recommended Fix:** Escape the value or attach event listeners programmatically.

### M-15: `var` Usage in `ls-micro.js`

- **File:** `frontend/ls-micro.js:17,21,38,46,57,76,78,90,96,98,102,105,108,149`
- **Description:** Mixed `var` and `let` declarations. `var` is function-scoped and can cause unexpected hoisting bugs.
- **Recommended Fix:** Standardize on `const` / `let`.

### M-16: Inconsistent Pagination Limits

- **Files:** `backend/src/routes/knowledgeBase.js:54` (limit 200), `backend/src/routes/responseHistory.js` (limit 500), `backend/src/routes/conversations.js:23` (no validation)
- **Description:** Each route defines its own pagination limits with no consistent validation pattern.
- **Recommended Fix:** Create shared pagination middleware with configurable max limits.

### M-17: No API Versioning

- **Files:** All route files
- **Description:** No API version prefix (e.g., `/api/v1/`). No versioning strategy for breaking changes.
- **Recommended Fix:** Consider implementing API versioning before acquiring company integrations need stability guarantees.

### M-18: Prompt Injection Logging Uses `console.warn`

- **File:** `backend/src/services/systemPromptBuilder.js:41`
- **Description:** Security-relevant prompt injection detection logs via `console.warn` instead of the structured logger, making it invisible to log aggregation.
- **Recommended Fix:** Use `log.warn()` with a `security` tag.

### M-19: Conversation Summarization Has No Retry

- **File:** `backend/src/routes/conversations.js:299`
- **Description:** Direct fetch to Anthropic API for conversation summarization has no retry logic. Network failures lose the request silently.
- **Recommended Fix:** Add retry with exponential backoff, or queue for later processing.

### M-20: No Transaction in Bulk Compliance KB Import Scripts

- **File:** `backend/scripts/import-all-compliance-kb.js:100-149`
- **Description:** Each entry is inserted individually without a transaction. A mid-script failure leaves the database in a partially-seeded state.
- **Recommended Fix:** Wrap in a database transaction.

### M-21: Missing `Math.max` Guard for Empty Arrays

- **File:** `frontend/admin-dashboard.js:183-184`
- **Description:** `Math.max(...toolUsage.map(x => parseInt(x.count)))` returns `-Infinity` if `toolUsage` is empty.
- **Recommended Fix:** Add guard: `if (!toolUsage || toolUsage.length === 0) return;`

### M-22: Email PII in Warning Logs

- **File:** `backend/src/services/email.js:45`
- **Description:** `console.warn('[EMAIL] Would have sent to:', to, '| Subject:', subject)` logs recipient email addresses. In production without SMTP configured, this leaks PII to stdout.
- **Recommended Fix:** Redact or omit the email address from the log message.

---

## Low

### L-1: Unused Legacy Variable `customKnowledge`

- **File:** `frontend/app.js:541`
- **Description:** `let customKnowledge = []` is marked as "Legacy alias" but still present. Should be removed if truly unused.

### L-2: Potentially Dead Function `stopFooterClock()`

- **File:** `frontend/app.js:503-509`
- **Description:** `stopFooterClock()` is defined but may never be called. Verify usage before removing.

### L-3: Hardcoded Cache TTL Values

- **Files:** `backend/src/services/cache.js:90-94`, `backend/src/services/shopify.js:260,285`, `backend/src/services/voiceFingerprint.js:16`
- **Description:** Cache TTL values are hardcoded rather than configurable via environment variables.
- **Recommended Fix:** Move to environment variables with sensible defaults.

### L-4: Inconsistent Function Declaration Styles (Frontend)

- **File:** `frontend/app.js`
- **Description:** Mixes `function name()`, `const name = () =>`, and `async function name()` styles inconsistently.
- **Recommended Fix:** Standardize on a single style per context.

### L-5: Global Scope Pollution in Frontend

- **File:** `frontend/app.js:512-597`
- **Description:** 20+ variables declared at module scope without encapsulation. Not using modules, classes, or namespace patterns.
- **Impact:** Naming collisions and difficulty reasoning about state.

### L-6: Missing JSDoc on Frontend Functions

- **Files:** All frontend `.js` files except `app.js` (which has partial JSDoc)
- **Description:** Most functions lack documentation. Frontend is especially sparse.

### L-7: `Promise.all` vs `Promise.allSettled` Inconsistency

- **Files:** `frontend/shopify-dashboard.js:138-148` (uses `allSettled`), `frontend/admin-dashboard.js:148` (uses `all`), `frontend/compliance.js:611` (uses `all`)
- **Description:** Some parallel fetches use `Promise.allSettled` (resilient to partial failures) while others use `Promise.all` (fails on any rejection). Should be consistent.

### L-8: Inline Styles in JavaScript HTML Strings

- **Files:** `frontend/compliance.js:39,60,182,202,257`, `frontend/shopify-dashboard.js:272,305,351`
- **Description:** CSS styles embedded in JavaScript `innerHTML` strings instead of CSS classes. Harder to maintain and blocks CSP enforcement.

### L-9: Hardcoded `defaultName = "Bella"`

- **File:** `frontend/app.js:528`
- **Description:** A hardcoded default name that appears to be test/development data left in the codebase.

### L-10: No Request ID / Correlation ID in Logs

- **File:** `backend/src/services/logger.js`
- **Description:** The structured logger includes timestamp and level but no request ID, making it impossible to trace multi-step request flows.
- **Recommended Fix:** Add request ID middleware and include it in all log entries.

### L-11: Token Safety Margin Hardcoded

- **File:** `backend/src/services/tokenCounter.js:17`
- **Description:** `0.75` safety margin for token counting is hardcoded. Should be configurable for different models.

### L-12: Frontend API_BASE_URL Defined Twice

- **Files:** `frontend/app.js:59-61`, `frontend/shopify-dashboard.js:9-13`
- **Description:** The same API base URL detection logic is duplicated. Should be defined once and imported.

### L-13: Database Connection Logging Uses `console.log`

- **File:** `backend/config/database.js:15,19`
- **Description:** Database connection and error events use `console.log`/`console.error` instead of the structured logger.

### L-14: No `.env` Pattern in `.gitignore`

- **File:** `.gitignore`
- **Description:** The `.gitignore` covers `.env.*` patterns but should explicitly include `.env` to prevent accidental commits of the base env file.

### L-15: `generate_brief.py` Appears Orphaned

- **File:** `generate_brief.py`
- **Description:** A Python script in the repo root that appears to be a one-time documentation generation tool. Should be in `scripts/` or removed if no longer needed.

---

## Cosmetic

### X-1: Inconsistent Comment Header Styles

- **Files:** Backend service files
- **Description:** Some files use JSDoc-style headers (`/** ... */`), others use line comments, and some have no header at all.

### X-2: Trailing Whitespace and Inconsistent Line Endings

- **Files:** Various frontend HTML and CSS files
- **Description:** Minor formatting inconsistencies throughout.

### X-3: Mixed Quotation Marks

- **Files:** Frontend JS files
- **Description:** Mix of single quotes and double quotes without consistent style enforcement.

### X-4: Unused `_idx` Destructuring Warning

- **File:** `backend/src/services/claude.js:339,342`
- **Description:** `const { _idx, _type, ...clean } = ex;` — `_idx` is intentionally unused (prefixed with `_`) but creates lint noise.

### X-5: Route Comment Block Says "legacy endpoint removed"

- **File:** `backend/src/routes/tools.js:602-605`
- **Description:** Dead documentation comment about a removed endpoint. Should be removed entirely rather than kept as a comment.

### X-6: `.env.example` Has Inconsistent Limit Values

- **File:** `backend/.env.example:41-43`
- **Description:** `.env.example` sets `TRIAL_USAGE_LIMIT=100` but `auth.js:148` defaults to `300` when the env var is missing. These should match.

### X-7: `Lightspeed_Technical_Brief.docx` in Repo Root

- **File:** `Lightspeed_Technical_Brief.docx`
- **Description:** A binary `.docx` file in the repository root. Binary documents should not be tracked in Git.

### X-8: Redundant CORS Origins

- **File:** `backend/src/index.js:66-68`
- **Description:** Both `https://www.lightspeedutility.ca` and `https://lightspeedutility.ca` are listed, plus `process.env.FRONTEND_URL` which is typically one of those same values. Minor redundancy.

---

## Fixes Applied in This Audit

The following safe, non-functional changes were applied as part of this audit:

1. **Backend `console.*` → structured logger** — Replaced all `console.log`, `console.warn`, and `console.error` calls in backend source files with the structured `log.*` equivalents
2. **Moved `fs`/`path` imports to top level** — Eliminated the `fs2`/`path2` aliasing in `index.js`
3. **Added null guard for embeddings** — Added null check in `chunkingService.js` before iterating embedding results
4. **Added email validation** — Added basic format validation in `email.js` before sending
5. **Replaced `console.*` in `config/database.js`** — Used structured logger for database connection events
6. **Replaced security-relevant `console.warn` in `systemPromptBuilder.js`** — Prompt injection detection now uses structured logger
7. **Added missing security headers** — Added `X-Content-Type-Options`, `Strict-Transport-Security`, and `Referrer-Policy` to `frontend/render-static.yaml`
8. **Removed dead route comment** — Cleaned up "legacy endpoint removed" comment in `tools.js`
9. **Fixed `.env.example` default mismatch** — Aligned `TRIAL_USAGE_LIMIT` default

---

*End of audit report. All findings verified by direct code inspection. No business logic was changed.*
