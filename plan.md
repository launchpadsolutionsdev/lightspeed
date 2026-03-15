# Plan: Calendar-Aware AI Tools + "Draw" Category in Runway

## Overview

Make Ask Lightspeed, Draft Assistant, and Response Assistant aware of upcoming Runway calendar events so they can answer questions like "when is the next draw?" using real calendar data. Also add a "Draw" category to Runway's category system.

---

## Part 1: Add "Draw" Category to Runway

**Files:** `frontend/index.html`, `frontend/app.js`

1. **HTML** — Add a `<button class="cal-category-chip" data-cat="Draw">Draw</button>` to the category filter bar (alongside Ad Launch, Social Post, etc.)
2. **JS** — Add `'Draw'` to the two `presets` arrays in `app.js` (lines ~7479 and ~7757) so it appears in the category dropdown when creating/editing events

That's it — the calendar already supports arbitrary category strings; we just need to register "Draw" as a preset.

---

## Part 2: Inject Calendar Events into AI Context

### Strategy

The draw schedule (`draw_schedules` table) already gets injected into all three AI tools. We'll add a **second context block** — "UPCOMING CALENDAR EVENTS" — that fetches the next 30 days of Runway events and formats them as a readable list. This gives the AI awareness of specific scheduled events (draws, ad launches, meetings, etc.) beyond just the static draw schedule.

### Backend Changes

**File: `backend/src/services/systemPromptBuilder.js`**

3. **New helper: `buildCalendarContext(organizationId)`**
   - Query `calendar_events` where `event_date >= TODAY` and `event_date <= TODAY + 30 days`, ordered by date/time
   - Expand recurring events using existing `expandRecurringEvent()` logic (extract to shared util)
   - Format as a concise list:
     ```
     UPCOMING CALENDAR EVENTS (next 30 days):
     - Wed Mar 18: $5,000 Early Bird [Draw]
     - Fri Mar 21: Spring Campaign Launch [Ad Launch]
     - Mon Mar 24: Team Sync [Meeting]
     ```
   - Cap at ~20 events to manage token budget
   - Return empty string if no events found

4. **Inject into Response Assistant prompt** — In `buildResponseAssistantPrompt()`, call `buildCalendarContext(organizationId)` and append alongside the existing draw schedule block

**File: `backend/src/routes/tools.js`**

5. **New API endpoint: `GET /api/calendar-context`**
   - Authenticated, returns the formatted calendar context string
   - Used by the frontend for Ask Lightspeed and Draft Assistant (which build prompts client-side)

### Frontend Changes

**File: `frontend/app.js`**

6. **New helper: `getCalendarContext()`**
   - Fetches `GET /api/calendar-context` with auth header
   - Caches result for 5 minutes (avoids repeated calls during a session)
   - Returns the formatted string or empty string on failure

7. **Ask Lightspeed** (~line 2708) — Insert calendar context into `dynamicSystem` after the draw schedule block

8. **Draft Assistant** (`buildDraftDynamicPrompt()`) — Same injection into the dynamic prompt layer

### Prompt Guidance

9. **Add instruction to static prompts** for all three tools:
   > "CALENDAR AWARENESS: When the user asks about upcoming dates, events, draws, campaigns, or deadlines, use the UPCOMING CALENDAR EVENTS data to give specific, accurate answers. Prefer calendar data over guessing."

---

## Summary of File Changes

| File | Changes |
|------|---------|
| `frontend/index.html` | Add "Draw" category chip button |
| `frontend/app.js` | Add "Draw" to presets; add `getCalendarContext()` helper; inject calendar context into Ask Lightspeed + Draft Assistant dynamic prompts; add calendar awareness line to static prompts |
| `backend/src/services/systemPromptBuilder.js` | Add `buildCalendarContext()` helper; inject into Response Assistant prompt; add calendar awareness instruction |
| `backend/src/routes/tools.js` | Add `GET /api/calendar-context` endpoint |

**No new database tables or migrations needed** — we're reading from the existing `calendar_events` table.
