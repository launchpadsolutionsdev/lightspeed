# Plan: System Status Page

## Overview

Create a real-time system status page at `status.html` that checks three backend services (Database, Anthropic AI API, and the Render-hosted backend itself) and displays their health with colored indicators. The existing hardcoded green dot in the footer becomes a live indicator linked to the status page.

---

## Architecture

### How It Works

```
[status.html]  ──fetch──▶  GET /health  (backend on Render)
                                │
                          ┌─────┴─────┐
                          │  Check DB  │  → SELECT 1
                          │  Check AI  │  → GET /v1/models (Anthropic)
                          └─────┬─────┘
                                │
                          JSON response:
                          {
                            status: "operational" | "degraded" | "down",
                            services: {
                              platform: { status, latency },
                              database: { status, latency },
                              ai:       { status, latency }
                            }
                          }
```

- **Platform (Render):** If the `/health` endpoint responds at all, Render is up. If the fetch fails entirely (network error / timeout), the frontend knows Render is down → **RED**.
- **Database:** Backend runs `SELECT 1` against Postgres and reports connected/disconnected.
- **AI API (Anthropic):** Backend makes a lightweight call to Anthropic's API to verify the key works and the service is reachable. If it fails → **YELLOW** (service interruption, not a full outage).

### Status Colors
- **Green** = operational (service responding normally)
- **Yellow** = degraded (service responding but with errors or high latency)
- **Red** = down (service unreachable or erroring)

---

## Changes

### 1. Backend: Enhance `GET /health` endpoint

**File:** `backend/src/index.js` (lines 106-113)

Replace the current basic health check with a comprehensive one that checks:
- Database connectivity (SELECT 1 with latency measurement)
- Anthropic API reachability (GET /v1/models with 5s timeout)
- Platform status (implicit — if the response is sent, Render is up)

The endpoint remains unauthenticated and outside `/api/` so it's publicly accessible.

---

### 2. Frontend: Create `status.html`

**File:** `frontend/status.html` (new file)

A standalone page following the same pattern as `about.html`, `security.html`, etc:

- Same nav bar, same footer, same design-system.css + landing.css imports
- **Hero section:** "System Status" heading with an overall status badge (green/yellow/red pill)
- **Services grid:** Three cards:
  - **Platform** — "Core infrastructure and API"
  - **Database** — "Data storage and retrieval"
  - **AI Engine** — "AI-powered response generation"
- Each card shows: colored dot, service name, status text, latency in ms
- **Auto-refresh:** Polls `/health` every 30 seconds, updates in real-time with smooth CSS transitions
- **Fallback:** If the fetch itself fails (Render is down), all services show RED and overall status shows "Major Outage"
- **Last checked timestamp** at the bottom

---

### 3. CSS: Add status page styles

**File:** `frontend/landing.css` (append at the end)

- `.status-hero` — overall status banner
- `.status-grid` — responsive 3-column grid for service cards
- `.status-card` — individual card with dot, name, status, latency
- `.status-badge` — overall status pill
- `.status-dot-operational` / `.status-dot-degraded` / `.status-dot-down` — color classes
- Smooth transitions for color changes
- Mobile responsive breakpoints

---

### 4. Frontend: Update footer across all 23 HTML pages

Two changes per file:

1. **Add "System Status" link** in the Resources column (after Help Center)
2. **Make the footer status dot live:** Wrap in a link to `status.html`, add an ID for JS targeting
3. **Add ~15-line inline script** that fetches `/health` on page load and updates the footer dot color + text

For files in subdirectories (e.g., `whats-new/*.html`), paths are adjusted to `../status.html`.

---

## Files Summary

| File | Action |
|------|--------|
| `backend/src/index.js` | Modify — enhance `/health` endpoint with DB + Anthropic checks |
| `frontend/status.html` | **Create** — new status page |
| `frontend/landing.css` | Modify — add status page styles + dot color classes |
| 23 HTML files with footers | Modify — add Status link + live footer dot |

---

## Out of Scope

- **Historical uptime tracking** — This is real-time only. Historical data would require logging health checks to a DB table over time.
- **Incident management** — No admin UI for posting incident updates. Consider BetterStack/Instatus later.
- **Email/SMS alerts** — Page is for user-facing visibility only.
