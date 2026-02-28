# Response Rules Implementation Plan

## Overview
Add persistent org-level "Response Rules" that get injected into every Response Assistant
generation. Rules like "never say X" or "always start with Y" are enforced automatically.

## Step 1: Database Migration
- Create `response_rules` table:
  - id, organization_id, rule_text, rule_type (always/never/formatting/general),
    is_active, sort_order, created_by, created_at, updated_at
- Seed Thunder Bay with two starter rules

## Step 2: Backend API
- `GET    /api/response-rules`           — list rules for org (sorted by sort_order)
- `POST   /api/response-rules`           — create a new rule
- `PUT    /api/response-rules/:id`       — update rule text/type/active status
- `PUT    /api/response-rules/reorder`   — bulk update sort_order
- `DELETE /api/response-rules/:id`       — delete a rule

## Step 3: Prompt Injection (tools.js)
- In both `/generate` and `/generate-stream`, after fetching org:
  - Query active response_rules for the org, ordered by sort_order
  - Format as numbered list with type labels
  - Inject into the system prompt BEFORE the "Knowledge base:" marker
- Also inject on `/draft` endpoint for Draft Assistant consistency

## Step 4: Frontend UI
- Add "Response Rules" panel in KB section (new tab or sub-section)
- List view: each rule shown with type chip, toggle switch, edit/delete buttons
- Add form: rule text textarea + type selector
- Drag-to-reorder (or up/down arrows for simplicity)
- Rule type color coding: ALWAYS=green, NEVER=red, FORMATTING=blue, GENERAL=gray

## Step 5: Seed Data
- Pre-populate Thunder Bay org with:
  1. [NEVER] "Never tell the customer to 'feel free to reach out' or suggest emailing us —
     they are already emailing us and would simply reply."
  2. [ALWAYS] "Start every email response with 'Hi there,' on the first line, followed by
     'Thank you for reaching out.' on the next line."
