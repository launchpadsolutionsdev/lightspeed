# Response Assistant Quality Improvements — Implementation Plan

## Overview
Six targeted changes to improve response quality, measurability, and user trust.
Estimated token cost impact: ~$0.003/request increase. No new infrastructure required.

---

## Change 1: Increase KB Entry Visibility for Haiku Relevance Picker
**File:** `backend/src/services/claude.js` line 168
**What:** Increase truncation from 150 → 500 characters in the Haiku catalogue
**Why:** Haiku makes relevance decisions on truncated content. 150 chars is often just the title and first sentence — not enough to distinguish between similar entries.

```
Before: entry.content.substring(0, 150)
After:  entry.content.substring(0, 500)
```

**Cost:** ~350 extra chars × 30 entries ÷ 4 = ~2,625 extra Haiku tokens per request (~$0.001)

---

## Change 2: Expand Rated Examples Pool and Final Selection
**Files:**
- `backend/src/services/systemPromptBuilder.js` lines 196-197, 221-228
- `backend/src/services/claude.js` line 233 (pickRelevantRatedExamples defaults)

### 2a: Increase fetch pool (database query limits)
```
Before: positiveLimit = inquiry ? 20 : 5;  negativeLimit = inquiry ? 10 : 3;
After:  positiveLimit = inquiry ? 30 : 8;  negativeLimit = inquiry ? 15 : 5;
```

### 2b: Increase final selection after Haiku filtering
```
Before: pickRelevantRatedExamples(inquiry, pos, neg, 5, 3)
After:  pickRelevantRatedExamples(inquiry, pos, neg, 8, 5)
```

### 2c: Skip Haiku filtering when pool is already at or below target
```
Before: if (inquiry && (positiveResult.rows.length > 5 || negativeResult.rows.length > 3))
After:  if (inquiry && (positiveResult.rows.length > 8 || negativeResult.rows.length > 5))
```

**Cost:** ~600 extra tokens in main prompt (~$0.002). Prompt caching makes subsequent calls 90% cheaper.

---

## Change 3: Fix FTS Fallback Re-Ranking Gap
**File:** `backend/src/services/promptBuilder.js` lines 94-100
**Problem:** When FTS returns <5 results, the fallback loads ALL KB entries sorted alphabetically. If the org has ≤8 entries total, `pickRelevantKnowledge` short-circuits (line 161-163) and returns them all without any Haiku ranking.

### 3a: Only trigger full fallback when FTS returns 0 results
```javascript
// Before: if (kbRows.length < 5)
// After:  if (kbRows.length === 0)
```
Rationale: If FTS found 1-4 results, those ARE the most relevant — don't dilute them with the entire KB.

### 3b: When fallback IS triggered (0 FTS results), pre-score large KBs
Keep the fallback loading all entries, but for large KBs (>30 entries), use tag-match scoring to narrow to top 30 before sending to Haiku:

```javascript
if (kbRows.length === 0) {
    const allResult = await pool.query(...);
    if (allResult.rows.length > 30) {
        kbRows = claudeService.tagMatchFallback(inquiry, allResult.rows, 30);
    } else {
        kbRows = allResult.rows;
    }
}
```

This requires exporting `tagMatchFallback` from claude.js (currently not exported).

---

## Change 4: Server-Side Quality Validation
**Files:**
- `backend/src/services/outputValidator.js` — extend with format-specific checks
- `backend/src/routes/tools.js` lines 105-111 — pass format context to validator

### 4a: Add format-aware validation to outputValidator.js
New function `validateFormatCompliance(text, format, options)` that checks:
- **Facebook:** char count > 400, contains line breaks, contains bullet points
- **Email:** word count < 20 or > 300, missing greeting, missing sign-off
- **Citation consistency:** response references `[1]`, `[2]` etc. but no KB entries were provided

### 4b: Send format violations as warnings in SSE done event
In `tools.js`, pass format to `validateOutput` and include format violations in the existing warnings array:
```javascript
const { warnings } = validateOutput(text, {
    orgEmails: [],
    format: req.body.format,
    hasKbEntries: referencedKbEntries.length > 0
});
```

### 4c: Display server-side warnings in the frontend
In `app.js`, when receiving SSE `done` event with warnings, display them in the quality checks section alongside the existing client-side checks. Server warnings get `quality-fail` styling.

---

## Change 5: Quality Metrics in Stats Endpoint
**Files:**
- New migration `024_add_quality_metrics.sql` — add columns to response_history
- `backend/src/routes/responseHistory.js` lines 152-176 — save metrics at insert time
- `backend/src/routes/responseHistory.js` lines 51-146 — extend stats endpoint

### 5a: New migration adds columns
```sql
ALTER TABLE response_history
    ADD COLUMN IF NOT EXISTS char_count INTEGER,
    ADD COLUMN IF NOT EXISTS word_count INTEGER,
    ADD COLUMN IF NOT EXISTS kb_entries_used INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quality_violations JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;
```

### 5b: Compute and save metrics when storing responses
In the POST /api/response-history endpoint, compute char_count, word_count before inserting.

### 5c: Extend stats endpoint with quality section
Add a `quality` object to the stats response:
```json
{
  "quality": {
    "avgCharCount": 245,
    "avgWordCount": 52,
    "facebookOverLimitRate": 8,
    "avgKbEntriesUsed": 3.2,
    "avgResponseTimeMs": 2400,
    "qualityTrend": [
      { "month": "2026-03", "positiveRate": 82, "avgKbEntries": 3.1 },
      { "month": "2026-02", "positiveRate": 78, "avgKbEntries": 2.8 }
    ]
  }
}
```

---

## Change 6: Feedback Loop Visibility
**File:** `frontend/app.js`

### 6a: Add hint text below rating buttons
After the rating buttons (line 7309), add a subtle hint:
```html
<div class="rating-hint">Your ratings train Lightspeed for your team</div>
```

### 6b: Enhance post-submission feedback messages
- Positive toast: "Thanks! This will improve responses starting now." (clearer immediacy)
- Negative toast with KB update: Keep as-is ("Knowledge base updated — Lightspeed will get this right next time!")
- Negative toast without KB: "Got it — future responses will avoid this pattern."

### 6c: Add feedback impact indicator in modal
In the feedback modal header (line 7641), add subtitle:
```html
<small class="feedback-subtitle">Your feedback improves responses immediately for your entire team</small>
```

---

## File Change Summary

| File | Changes |
|------|---------|
| `backend/src/services/claude.js` | Line 168: 150→500 chars. Export `tagMatchFallback`. |
| `backend/src/services/systemPromptBuilder.js` | Lines 196-197: increase limits. Lines 221-228: update thresholds. |
| `backend/src/services/promptBuilder.js` | Lines 94-100: fix fallback, add pre-scoring for large KBs. |
| `backend/src/services/outputValidator.js` | Add `validateFormatCompliance()` function. |
| `backend/src/routes/tools.js` | Lines 105-111: pass format to validator, include format warnings. |
| `backend/src/routes/responseHistory.js` | Lines 152-176: save quality metrics. Lines 51-146: extend stats. |
| `backend/migrations/024_add_quality_metrics.sql` | New migration for quality columns. |
| `frontend/app.js` | Lines 7305-7309: add rating hint. Lines 7570, 7850-7852: update toasts. Line 7641: add modal subtitle. Handle server warnings in SSE done event. |

## Execution Order
1. Change 1 (KB visibility) — standalone, no dependencies
2. Change 2 (rated examples) — standalone, no dependencies
3. Change 3 (FTS re-ranking) — requires Change 1's `tagMatchFallback` export
4. Change 5 (migration + quality metrics) — must run before Change 4
5. Change 4 (server-side validation) — depends on Change 5 columns existing
6. Change 6 (feedback UI) — standalone, no dependencies
