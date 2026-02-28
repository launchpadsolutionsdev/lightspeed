# Knowledge Base Split: Implementation Plan

## Overview

Split the single `knowledge_base` table into two purpose-driven knowledge bases:
1. **Customer Support KB** — feeds Response Assistant (customer-facing tools)
2. **Internal/Operations KB** — feeds Draft Assistant, Ask Lightspeed (internal tools)

---

## 1. Database Schema Changes

### Approach: Add a `kb_type` discriminator column

Add a single column to the existing `knowledge_base` table rather than creating two separate tables. This preserves all existing foreign keys, indexes, audit logging, and import/export infrastructure.

```sql
-- New migration: 020_add_kb_type.sql

ALTER TABLE knowledge_base
    ADD COLUMN IF NOT EXISTS kb_type VARCHAR(20) NOT NULL DEFAULT 'support';

CREATE INDEX IF NOT EXISTS idx_knowledge_base_type
    ON knowledge_base(organization_id, kb_type);

-- Auto-classify obviously internal entries
UPDATE knowledge_base
SET kb_type = 'internal'
WHERE category IN ('brand_voice', 'terminology', 'internal')
   OR title ILIKE '%brand voice%'
   OR title ILIKE '%terminology%'
   OR title ILIKE '%media contact%';
```

**Valid values:** `'support'` | `'internal'`

### Why one table with a type column, not two tables

- All existing FKs (`source_response_id`, `feedback_kb_entry_id`, `created_by`) stay intact
- Audit logging, import, export, doc upload, admin routes work with minimal changes
- Cross-KB search (admin use case) stays trivial
- No data migration — just a column addition with safe defaults
- Future types (e.g., `compliance`, `product`) can be added without new tables or migrations

### Existing schema — no changes needed

| Column | Status |
|--------|--------|
| `id`, `organization_id`, `title`, `content` | Unchanged |
| `category` | Unchanged — each kb_type will have its own preset categories |
| `tags` | Unchanged — lottery:/keyword: prefixes still work |
| `created_by`, `created_at`, `updated_at` | Unchanged |
| `source_response_id` | Unchanged — feedback→KB flow stays support-only |

### Category presets per KB type

**Support KB:** `products`, `policies`, `faqs`, `draw_rules`, `support`, `general`

**Internal KB:** `brand_voice`, `campaigns`, `procedures`, `reference`, `guidelines`, `general`

---

## 2. Backend API Changes

### 2a. Knowledge Base Routes (`routes/knowledgeBase.js`)

Every endpoint adds `kb_type` as a query param or body field:

| Endpoint | Change |
|----------|--------|
| `GET /api/knowledge-base` | Add required `?type=support\|internal` query param. Filter: `WHERE kb_type = $type` |
| `POST /api/knowledge-base` | Accept `kb_type` in body (default `'support'`). Validate against `['support', 'internal']` |
| `PUT /api/knowledge-base/:id` | Allow changing `kb_type` (move entry between KBs) |
| `DELETE /api/knowledge-base/:id` | No change needed |
| `GET /api/knowledge-base/search` | Add `?type=` filter |
| `POST /api/knowledge-base/from-feedback` | Hardcode `kb_type = 'support'` (feedback always targets customer KB) |
| `POST /api/knowledge-base/import` | Accept `kb_type` in body |
| `GET /api/knowledge-base/export/all` | Add `?type=` filter |
| `POST /api/knowledge-base/upload-doc` | Accept `kb_type` in body |

### 2b. Tools Routes (`routes/tools.js`) — The critical routing change

**Response Assistant** (`/api/generate` and `/api/generate-stream`):
```sql
-- Current (no type filter):
SELECT id, title, content, category, tags FROM knowledge_base WHERE organization_id = $1

-- New:
SELECT id, title, content, category, tags FROM knowledge_base
WHERE organization_id = $1 AND kb_type = 'support'
```

**Draft Assistant** (`/api/draft`):
Currently has NO server-side KB injection. The frontend dumps 15 entries client-side into the system prompt. This needs to be upgraded:
```sql
-- New: add server-side KB picking to /api/draft
SELECT id, title, content, category, tags FROM knowledge_base
WHERE organization_id = $1 AND kb_type = 'internal'
```
Then use `pickRelevantKnowledge()` to select the best entries and inject them into the system prompt (same pattern as `/api/generate`).

**Ask Lightspeed** (calls `/api/generate-stream`):
Ask Lightspeed is a general-purpose assistant that may need entries from either KB. The backend should query both types and let Haiku pick the most relevant:
```sql
SELECT id, title, content, category, tags FROM knowledge_base
WHERE organization_id = $1 AND kb_type IN ('support', 'internal')
```

To distinguish this from a Response Assistant call (which should only use `support`), add a `kb_type` field to the request body:
- Response Assistant sends `kb_type: 'support'`
- Ask Lightspeed sends `kb_type: 'all'`

### 2c. Admin Routes (`routes/admin.js`)

Add `?type=` filter to admin KB listing/management endpoints. Allow admins to see both types.

---

## 3. Frontend Changes

### 3a. Two-Tab KB Management Page

Currently KB management lives at `/response-assistant/knowledge` as a sub-page of Response Assistant. With the split, this becomes a tabbed interface:

```
┌──────────────────────────────────────────────────────┐
│ Knowledge Base                                        │
│                                                       │
│ ┌─────────────────┐  ┌─────────────────────────────┐ │
│ │ Customer Support │  │ Internal / Operations       │ │
│ └─────────────────┘  └─────────────────────────────┘ │
│                                                       │
│  Subtitle explaining what this KB feeds               │
│                                                       │
│ ┌─ Stats ──────────────────────────────────────────┐ │
│ │  12 entries  ·  4 FAQs  ·  3 Policies  ·  ...   │ │
│ └──────────────────────────────────────────────────┘ │
│                                                       │
│ [Search...]       [Category ▼]     [+ Add Entry]     │
│                                                       │
│ ┌─ Entry card ─────────────────────────────────────┐ │
│ │ How do I buy a 50/50 ticket?                      │ │
│ │ Visit our website at...                           │ │
│ │ [FAQs] [Your KB]    [Move to Internal] [Delete]   │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 3b. Tab-specific behavior

**Customer Support KB tab:**
- Header: "Customer Support Knowledge Base"
- Subtitle: "Powers the Response Assistant. Add FAQs, policies, ticket responses, and draw rules."
- Category dropdown: Products, Policies, FAQs, Draw Rules, Support, General
- Form fields: Question, Response, Category, Lottery (50/50 / CTA / Both), Keywords
- Actions per entry: Edit, Move to Internal, Delete

**Internal/Operations KB tab:**
- Header: "Internal Knowledge Base"
- Subtitle: "Powers Draft Assistant and Ask Lightspeed. Add brand voice, campaign history, procedures, and reference material."
- Category dropdown: Brand Voice, Campaigns, Procedures, Reference, Guidelines, General
- Form fields: Title, Content, Category, Tags
- No "Lottery" field (irrelevant)
- Actions per entry: Edit, Move to Support, Delete

### 3c. Add inline editing (currently missing)

Currently entries can only be deleted, not edited from the KB page (editing only happens via the feedback modal). Add:
- Click entry to expand it into an editable form
- Edit title, content, category, tags in-place
- Save triggers `PUT /api/knowledge-base/:id`
- Cancel collapses back to read-only view

### 3d. Frontend state changes

Split the single `customKnowledge` array into two:
```javascript
let supportKnowledge = [];    // was: customKnowledge
let internalKnowledge = [];   // new
```

`loadKnowledgeFromBackend()` becomes parameterized:
```javascript
async function loadKnowledgeFromBackend(kbType = 'support') {
    const response = await fetch(
        `${API_BASE_URL}/api/knowledge-base?type=${kbType}`,
        { headers: getAuthHeaders() }
    );
    // Store in the appropriate array
}
```

### 3e. Tool integration changes

**Response Assistant (`generateCustomResponse`):** No frontend change needed. Already passes `inquiry` to the backend, which picks KB entries server-side. Just need the backend to filter by `kb_type = 'support'`.

**Draft Assistant (`buildEnhancedSystemPrompt`):**
Lines 9452-9457 currently inject the first 15 `customKnowledge` entries client-side. Two options:
1. Change to inject from `internalKnowledge` instead (quick fix)
2. Remove client-side injection entirely and add server-side KB picking to `/api/draft` (better, consistent with Response Assistant)

Recommend option 2 — add server-side picking to `/api/draft`.

**Ask Lightspeed:** Already passes `inquiry` to `/api/generate-stream`. Add `kb_type: 'all'` to the request body so the backend merges both KBs.

### 3f. Command Palette update

Replace the single KB command with two:
```javascript
{ id: 'kb-support', label: 'Support KB', desc: 'Customer support knowledge', ... },
{ id: 'kb-internal', label: 'Internal KB', desc: 'Internal operations knowledge', ... },
```

---

## 4. Migration Strategy for Existing Data

### Step 1: Add column with safe default
All existing entries get `kb_type = 'support'`. This is non-breaking — everything continues working exactly as before.

### Step 2: Auto-classify obvious entries
The migration reclassifies entries that are clearly internal:
- Category `brand_voice` or `terminology` → `internal`
- Titles containing "brand voice", "terminology", "media contact" → `internal`
- Thunder Bay seed data: 3 brand voice entries → `internal`, 13 lottery entries stay `support`

### Step 3: Leave ambiguous entries as `support`
Better to have an internal entry incorrectly in `support` (it still gets used by Response Assistant) than to accidentally remove a support entry from the Response Assistant.

### Step 4: Give users a "Move" action
Each entry card gets a "Move to Internal KB" or "Move to Support KB" button. This lets organizations fine-tune the split at their own pace.

### Rollback safety
`kb_type` is just a column. Ignoring it (removing the WHERE clause) reverts to single-KB behavior. No data is lost or moved between tables.

---

## 5. Tool → KB Routing Summary

| Tool | KB Source | Picking Method | Change Required |
|------|-----------|---------------|-----------------|
| **Response Assistant** | `support` only | Server-side Haiku picker | Add `WHERE kb_type = 'support'` to existing query |
| **Draft Assistant** | `internal` only | **New:** Server-side Haiku picker | Add KB injection to `/api/draft` endpoint |
| **Ask Lightspeed** | Both | Server-side Haiku picker (merged pool) | Add `kb_type` param, query both types |
| **Insights Engine** | Neither | N/A | No change |
| **List Normalizer** | Neither | N/A | No change |
| **Rules of Play** | Neither | N/A | No change |

---

## 6. Concerns and Tradeoffs

### 1. User confusion about which KB to use
**Mitigation:** Clear labels, contextual subtitles, and a "Move to..." action on each entry. The tab labels and descriptions make the purpose of each KB explicit.

### 2. Draft Assistant has no server-side KB injection today
The `/api/draft` endpoint currently relies on the frontend injecting the first 15 entries from `customKnowledge` into the system prompt. This is the biggest backend change: adding `pickRelevantKnowledge()` to the draft endpoint, same pattern as `/api/generate`.

### 3. Ask Lightspeed is general-purpose
Restricting it to only the internal KB would be limiting — users might ask "what's our refund policy?" (support) or "what's our brand voice?" (internal). Querying both KBs and letting Haiku pick is the right approach.

### 4. Feedback→KB flow
When a user creates a KB entry from response feedback (`POST /api/knowledge-base/from-feedback`), it should always go to `support` since feedback comes from the Response Assistant.

### 5. Existing seeded data (Thunder Bay)
The seed migration (005) creates 16 entries. 13 are lottery/support FAQs, 3 are brand voice. The migration auto-classifies those 3 as `internal`.

---

## 7. Possible Enhancement: "Shared" entries

Some entries belong in both KBs (e.g., "Organization mission statement"). Rather than duplicating:
- A third value `kb_type = 'shared'` included in queries for both types
- Support queries: `WHERE kb_type IN ('support', 'shared')`
- Internal queries: `WHERE kb_type IN ('internal', 'shared')`

This is optional and can be added later without any schema changes.

---

## 8. Implementation Order

1. **Database migration** — Add `kb_type` column + index + auto-classify
2. **Backend KB routes** — Add `type` filter to all CRUD endpoints
3. **Backend tools routes** — Filter by `kb_type` in `/api/generate` + `/api/generate-stream`, add KB injection to `/api/draft`
4. **Frontend state** — Split `customKnowledge` into `supportKnowledge` + `internalKnowledge`
5. **Frontend UI** — Two-tab KB page with type-aware forms, inline editing, move action
6. **Frontend tool integration** — Update `buildEnhancedSystemPrompt`, Ask Lightspeed request body
7. **Polish** — Cmd+K commands, skeleton loaders, empty states
8. **Admin** — Update admin KB management with type column

### Files changed

| File | Action |
|------|--------|
| `backend/migrations/020_add_kb_type.sql` | **New** — migration |
| `backend/src/routes/knowledgeBase.js` | Modify — add type filter to all endpoints |
| `backend/src/routes/tools.js` | Modify — filter generate by support, add KB to draft, add kb_type param |
| `backend/src/routes/admin.js` | Modify — add type filter |
| `frontend/app.js` | Modify — split KB state, two-tab UI, inline edit, tool integration |
| `frontend/index.html` | Modify — KB page HTML with tabs |
