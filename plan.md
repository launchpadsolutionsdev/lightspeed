# Plan: Remove Draw Schedule System (Replace with Runway Calendar)

## Overview

Remove the entire draw schedule management system — the `draw_schedules` DB table, backend routes, Teams UI, Response Assistant display, frontend JS functions, and all AI prompt injections. Draws are now managed exclusively through Runway calendar events (with the new "Draw" category).

---

## What Gets Removed

### Files to DELETE entirely
1. **`backend/src/routes/drawSchedules.js`** — All CRUD + upload routes
2. **`frontend/draw-schedule.js`** — Legacy hardcoded schedule object

### New migration
3. **`backend/migrations/045_drop_draw_schedules.sql`** — `DROP TABLE IF EXISTS draw_schedules`

### Backend edits

4. **`backend/src/index.js`**
   - Remove `require('./routes/drawSchedules')` import
   - Remove `app.use('/api/draw-schedules', ...)` route mount

5. **`backend/src/services/systemPromptBuilder.js`**
   - Delete `buildDrawScheduleContext()` function (~90 lines)
   - Remove `drawScheduleContext` fetch + injection from `buildResponseAssistantPrompt()`
   - Remove "DRAW DATE AWARENESS" instruction (now covered by "CALENDAR AWARENESS")
   - Remove `buildDrawScheduleContext` from `module.exports`

6. **`backend/src/routes/admin.js`**
   - Remove `draw_schedules` soft-reference nullification on user delete
   - Remove draw schedule status fetch from org dashboard

7. **`backend/src/routes/export.js`**
   - Remove draw_schedules from the data export

### Frontend HTML edits

8. **`frontend/index.html`**
   - Remove `<script src="draw-schedule.js">` tag
   - Remove draw schedule card from Response Assistant (`#drawScheduleContainer`)
   - Remove draw schedule CSS (`.draw-schedule-card`, `.early-bird-*` rules)
   - Remove entire Draw Schedule Management section from Teams page (`#drawScheduleSection`, edit form, upload inputs)
   - Remove early bird edit CSS (`.early-bird-edit-row`)

### Frontend JS edits

9. **`frontend/app.js`**
   - Remove `orgDrawSchedule` global variable
   - Delete functions: `getOrgDrawScheduleAIContext()`, `getDrawScheduleContext()`, `renderDrawSchedule()`, `loadDrawScheduleFromBackend()`, `displayActiveSchedule()`, `displayNoSchedule()`, `handleDrawScheduleUpload()`, `handleDrawSchedulePaste()`, `toggleEditSchedule()`, `toLocalDatetimeValue()`, `addEarlyBirdRow()`, `cancelEditSchedule()`, `saveDrawScheduleEdits()`, `deleteDrawSchedule()`
   - Remove `loadDrawScheduleFromBackend()` call from init
   - Remove `renderDrawSchedule()` call
   - Remove `drawScheduleBlock` injection from Ask Lightspeed dynamic prompt
   - Remove `drawCtx` injection from Draft Assistant dynamic prompt
   - Update static prompt instructions to no longer reference "draw schedule data"

10. **`frontend/admin-dashboard.js`**
    - Remove draw schedule checklist item from org setup status

---

## What Stays

- **Calendar events (`calendar_events` table)** — untouched, this is the new source of truth
- **`buildCalendarContext()`** — already built, already injected into all three AI tools
- **"Draw" category in Runway** — already added as a preset
- **CALENDAR AWARENESS prompt instructions** — already in all three tools

## Summary

~15 functions deleted, ~200 lines of HTML removed, 2 files deleted, 1 new migration. The calendar context we just built fully replaces the draw schedule system for AI awareness.
