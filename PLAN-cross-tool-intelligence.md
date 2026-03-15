# Phase 1: Cross-Tool Intelligence

## Goal
Make every Lightspeed AI tool context-aware — each tool should benefit from the Knowledge Base, org rules, calendar events, conversation memory, cross-tool history, voice fingerprint, and corrections feedback. Today only Response Assistant and Ask Lightspeed have full context; Draft Assistant has partial context; Insights Engine and List Normalizer are completely siloed.

## Current State

| Context Layer | Response Asst | Ask Lightspeed | Draft Asst | Insights | List Normalizer |
|---|---|---|---|---|---|
| Knowledge Base | ✓ server | ✓ server | ✓ server | ✗ | ✗ |
| Response Rules | ✓ | ✓ | ✓ | ✗ | ✗ |
| Calendar Events | ✓ server | ✓ frontend | ✓ frontend | ✗ | ✗ |
| Conversation Memory | ✓ | ✓ | ✗ | ✗ | ✗ |
| Cross-Tool Context | ✓ | ✓ | ✗ | ✗ | ✗ |
| Voice Fingerprint | ✓ | ✓ | ✗ | brand_voice only | ✗ |
| Corrections/Feedback | ✓ | ✓ | ✓ | ✗ | ✗ |

## Target State (Phase 1 Complete)

All five tools share a **unified context injection pipeline** via `buildEnhancedPrompt()` on the server, with per-tool relevance filtering.

| Context Layer | Response Asst | Ask Lightspeed | Draft Asst | Insights | List Normalizer |
|---|---|---|---|---|---|
| Knowledge Base | ✓ | ✓ | ✓ | ✓ (light) | ✗ |
| Response Rules | ✓ | ✓ | ✓ | ✗ | ✗ |
| Calendar Events | ✓ | ✓ | ✓ | ✓ (light) | ✗ |
| Conversation Memory | ✓ | ✓ | ✓ | ✗ | ✗ |
| Cross-Tool Context | ✓ | ✓ | ✓ | ✓ | ✗ |
| Voice Fingerprint | ✓ | ✓ | ✓ | ✓ | ✗ |
| Corrections/Feedback | ✓ | ✓ | ✓ | ✓ | ✗ |

> **List Normalizer** stays isolated intentionally — it's a data transformation tool that outputs JavaScript functions or JSON arrays. Injecting org context would add noise without benefit.

---

## Implementation Steps

### Step 1: Unify the Context Pipeline (Backend Refactor)
**Files:** `backend/src/services/promptBuilder.js`, `backend/src/services/systemPromptBuilder.js`

**What:** Create a single `buildToolContext(toolName, orgId, inquiry, options)` function that wraps the existing context-gathering calls and returns a structured context object. Each tool specifies which layers it wants via an options/config map.

```js
// New unified interface
const contextConfig = {
  response_assistant: { kb: true, rules: true, calendar: true, memory: true, crossTool: true, voice: true, corrections: true },
  ask_lightspeed:     { kb: true, rules: true, calendar: true, memory: true, crossTool: true, voice: true, corrections: true },
  draft_assistant:    { kb: true, rules: true, calendar: true, memory: true, crossTool: true, voice: true, corrections: true },
  insights_engine:    { kb: 'light', rules: false, calendar: 'light', memory: false, crossTool: true, voice: true, corrections: true },
  list_normalizer:    { kb: false, rules: false, calendar: false, memory: false, crossTool: false, voice: false, corrections: false },
};
```

- `'light'` mode = inject only the top 3 most relevant KB entries and only upcoming calendar events (next 7 days), keeping token usage low for data-heavy tools.
- Refactor the existing scattered context calls in `buildEnhancedPrompt()` to use this config-driven approach.
- No behavior change for Response Assistant or Ask Lightspeed — this is a **refactor**, not a rewrite.

**Effort:** Medium — restructuring existing code, no new functionality yet.

---

### Step 2: Upgrade Draft Assistant to Server-Side Prompt Building
**Files:** `backend/src/routes/tools.js`, `frontend/app.js` (lines ~11580-11710)

**What:** Draft Assistant currently builds its dynamic system prompt on the frontend (calendar events, brand voice, templates, rated examples). Move this to the server so it can benefit from the unified context pipeline.

Changes:
1. Create a new endpoint: `POST /api/draft-assistant/generate` (streaming)
2. Accept: `{ topic, contentType, platform, details, tone, variantCount, language }`
3. Server builds the full prompt using `buildToolContext('draft_assistant', ...)` — injecting KB, rules, calendar, memory, cross-tool context, voice fingerprint, and corrections
4. Merge the existing frontend-built dynamic prompt (brand voice, templates, rated examples) into the server-side builder
5. Frontend calls the new endpoint instead of the generic `/api/generate-stream`
6. Keep the generic endpoint working for backward compatibility

**Why server-side?** The frontend can't access conversation memory, cross-tool context, or voice fingerprint — these require database queries. Moving prompt building server-side unlocks the full context pipeline.

**Effort:** Medium-High — significant frontend/backend coordination, but well-precedented by Response Assistant's architecture.

---

### Step 3: Upgrade Insights Engine with Contextual Awareness
**Files:** `backend/src/routes/tools.js` (lines ~341-425)

**What:** Insights Engine currently has a minimal system prompt with no org context. Add lightweight context injection:

1. Inject **voice fingerprint** so analysis reports match the org's communication style
2. Inject **light KB** (top 3 relevant entries) so the engine can reference org-specific terms, products, or programs when analyzing data
3. Inject **light calendar** (next 7 days of events) so analysis can reference upcoming draws, campaigns, or deadlines
4. Inject **cross-tool context** so it can reference recent drafts, responses, or normalizations when discussing the data
5. Inject **corrections** so past feedback on analysis quality improves future outputs

Changes:
1. Route the `/api/analyze` endpoint through `buildToolContext('insights_engine', ...)`
2. Append context as additional system prompt sections
3. Add the `tool: 'insights_engine'` tag consistently to response_history saves (verify this is already happening)

**Effort:** Low-Medium — the endpoint is simple and the context pipeline from Step 1 does the heavy lifting.

---

### Step 4: Cross-Tool Context Improvements
**Files:** `backend/src/services/conversationMemory.js`

**What:** The existing `getCrossToolContext()` function pulls the last 5 responses from other tools in the past 24 hours. Enhance it:

1. **Smart relevance filtering** — Instead of just "last 5 from each tool", use the current inquiry to find semantically relevant past outputs across all tools. Example: if a user is drafting a social post about a draw, surface the recent Insights analysis about draw performance.

2. **Structured summaries** — Instead of injecting raw inquiry+response pairs (which can be long), generate concise summaries. Use a lightweight approach: truncate responses to first 200 chars + "..." for non-Ask tools, keep full for Ask Lightspeed conversation context.

3. **Extend time window** — Move from 24 hours to 72 hours for cross-tool context. Users often work on campaigns across multiple days.

4. **Add tool output type tags** — Tag cross-tool entries with their output type (e.g., "data analysis", "social post", "customer response") so the consuming tool can prioritize relevance.

**Effort:** Medium — requires changes to the memory service and prompt injection logic.

---

### Step 5: Frontend UX — Cross-Tool Context Indicator
**Files:** `frontend/app.js`

**What:** Give users visibility into what context each tool is using. Add a small, collapsible "Context" indicator below each tool's output area:

1. After a response is generated, show a subtle bar: "Used: 4 KB entries, 2 rules, 3 recent activities"
2. Clicking it expands to show which KB entries, which rules, and which cross-tool activities were referenced
3. This already partially exists for Response Assistant (KB citations). Extend the pattern to all tools.
4. Use the existing `kb` SSE event that streams referenced KB entries — add similar events for other context types

Changes:
- Backend: Include a `context_summary` object in the SSE `done` event for all tools
- Frontend: Render the context summary below each tool's output area
- Design: Match existing KB citation UI pattern (subtle, collapsible)

**Effort:** Medium — frontend UI work + backend event additions.

---

### Step 6: Unified Response History Tags
**Files:** `backend/src/routes/tools.js`, `backend/src/routes/responseHistory.js`

**What:** Ensure all tools consistently save to `response_history` with proper metadata so cross-tool context works reliably:

1. Verify every tool endpoint saves with the correct `tool` field value
2. Add `context_layers_used` JSON column to response_history (new migration) tracking which context was injected
3. Add `content_type` field (e.g., "social_post", "email_response", "data_analysis", "normalized_list") for better cross-tool relevance matching
4. Index on `(organization_id, tool, created_at)` for fast cross-tool queries

**Migration:**
```sql
ALTER TABLE response_history
  ADD COLUMN IF NOT EXISTS context_layers_used JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_response_history_cross_tool
  ON response_history(organization_id, tool, created_at DESC);
```

**Effort:** Low — migration + minor changes to save calls.

---

## Execution Order

```
Step 6 (DB migration)     ──→ can deploy independently, no breaking changes
Step 1 (Unified pipeline) ──→ refactor, no behavior change for existing tools
Step 3 (Insights upgrade) ──→ depends on Step 1, low risk
Step 2 (Draft upgrade)    ──→ depends on Step 1, most complex step
Step 4 (Cross-tool improvements) ──→ depends on Step 1, enhances all tools
Step 5 (Frontend UX)      ──→ depends on Steps 1-4, polish layer
```

Steps 6 and 1 can be done together. Steps 2 and 3 can be parallelized after Step 1 is complete.

---

## What This Unlocks

- **Draft Assistant** knows about recent customer responses, so it can align marketing messaging with support tone
- **Insights Engine** references org terminology and upcoming events when analyzing data, producing more actionable reports
- **All tools** benefit from the corrections feedback loop — quality improvements compound across the platform
- **Users see** what context informed each response, building trust and enabling better prompt tuning
- **Future phases** (tool chaining, suggested workflows, automated handoffs) have a solid foundation to build on

---

## Out of Scope (Future Phases)

- **Tool chaining UI** — "Analyze this data → Draft a report about it" workflows
- **Proactive suggestions** — "You drafted a social post about the Spring Draw. Want to check if the KB has FAQ entries for it?"
- **Shared workspace** — Persistent cross-tool project context beyond 72-hour window
- **Real-time sync** — Live updates when one tool's output affects another's context
