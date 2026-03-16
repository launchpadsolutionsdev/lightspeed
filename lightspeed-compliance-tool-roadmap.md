# Lightspeed Compliance Tool — Full Build Roadmap

This is a new standalone tool within Lightspeed called **Compliance**. It is an AI-powered compliance assistant that helps charitable lottery operators get instant, jurisdiction-aware guidance on provincial regulations, rules, and laws across Canada.

This tool is completely separate from all other Lightspeed tools (Ask Lightspeed, Draft Assistant, Response Assistant, etc.). It has its own knowledge base, its own UI, its own access controls, and its own AI prompt system.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Database & Knowledge Base Schema](#2-database--knowledge-base-schema)
3. [Access Control & Permissions](#3-access-control--permissions)
4. [Backend API Endpoints](#4-backend-api-endpoints)
5. [AI Prompt System](#5-ai-prompt-system)
6. [Frontend UI — Split-Screen Chat Interface](#6-frontend-ui--split-screen-chat-interface)
7. [Disclaimer System](#7-disclaimer-system)
8. [Super Admin Knowledge Base Management UI](#8-super-admin-knowledge-base-management-ui)
9. [Initial Content — Ontario (AGCO)](#9-initial-content--ontario-agco)
10. [Future Jurisdiction Template](#10-future-jurisdiction-template)
11. [Guardrails](#11-guardrails)

---

## 1. Architecture Overview

### How It Fits Into Lightspeed
- Compliance is a new tool accessible from Lightspeed's main navigation, alongside the existing tools
- It has its own dedicated route/page
- It does NOT share a knowledge base with the other tools — it has a completely separate compliance-specific knowledge base
- It does NOT appear in the existing knowledge base management UI — it has its own admin interface

### High-Level Flow
1. User opens the Compliance tool
2. User selects (or has pre-selected) their jurisdiction (province/territory)
3. User asks a question in natural language (e.g., "Do I need a licence amendment to change my draw date?")
4. Backend sends the question + relevant knowledge base entries for that jurisdiction to the AI
5. AI generates a plain-language answer with citations to specific knowledge base entries
6. Frontend displays the answer in a chat interface (left panel) and the cited sources in a reference panel (right panel)
7. Every response includes a mandatory disclaimer

---

## 2. Database & Knowledge Base Schema

### Compliance Knowledge Base Table

Create a new table (or collection, depending on existing DB) called `compliance_knowledge_base`. This is completely separate from the existing knowledge base used by other tools.

Each entry represents a single topic or section of regulatory content for a specific jurisdiction.

```
compliance_knowledge_base:
  id                  — unique identifier
  jurisdiction_code   — province/territory code (e.g., "ON", "BC", "AB", "QC")
  jurisdiction_name   — full name (e.g., "Ontario")
  regulatory_body     — name of the regulator (e.g., "Alcohol and Gaming Commission of Ontario (AGCO)")
  category            — topic category (e.g., "Licensing", "Reporting", "Online Sales", "Draw Rules", "Prize Limits", "Advertising", "Financial Requirements")
  title               — human-readable title (e.g., "Licence Amendment Requirements")
  content             — the actual regulatory guidance content, written in plain language with references to specific sections/regulations
  source_name         — official source document name (e.g., "AGCO Registrar's Standards for Lottery Licensing")
  source_url          — direct URL to the official government page
  source_section      — specific section reference if applicable (e.g., "Section 4.2")
  last_verified_date  — date this content was last confirmed as current (ISO date)
  verified_by         — who verified it (e.g., "Torin" or "System")
  created_at          — timestamp
  updated_at          — timestamp
  is_active           — boolean, so entries can be deactivated without deletion
```

### Compliance Chat History Table

Store conversation history so users can return to past compliance queries.

```
compliance_conversations:
  id                  — unique identifier
  org_id              — the organization
  user_id             — the user who asked
  jurisdiction_code   — which jurisdiction this conversation is about
  created_at          — timestamp
  updated_at          — timestamp

compliance_messages:
  id                  — unique identifier
  conversation_id     — foreign key to compliance_conversations
  role                — "user" or "assistant"
  content             — the message text
  citations           — JSON array of knowledge base entry IDs that were cited in this response
  created_at          — timestamp
```

### Jurisdictions Reference Table

```
compliance_jurisdictions:
  code                — province/territory code ("ON", "BC", "AB", etc.)
  name                — full name ("Ontario", "British Columbia", etc.)
  regulatory_body     — name of the regulator
  regulatory_url      — main website URL for the regulator
  is_active           — boolean (only enable jurisdictions that have content populated)
  entry_count         — cached count of knowledge base entries for this jurisdiction
```

Pre-populate this table with all 13 Canadian provinces and territories, but only set `is_active: true` for Ontario initially. The others should exist but be inactive:

| Code | Name | Regulatory Body | Active |
|------|------|----------------|--------|
| ON | Ontario | Alcohol and Gaming Commission of Ontario (AGCO) | true |
| BC | British Columbia | Gaming Policy and Enforcement Branch (GPEB) | false |
| AB | Alberta | Alberta Gaming, Liquor and Cannabis (AGLC) | false |
| SK | Saskatchewan | Saskatchewan Liquor and Gaming Authority (SLGA) | false |
| MB | Manitoba | Liquor, Gaming and Cannabis Authority of Manitoba (LGCA) | false |
| QC | Quebec | Régie des alcools, des courses et des jeux (RACJ) | false |
| NB | New Brunswick | New Brunswick Lotteries and Gaming Corporation | false |
| NS | Nova Scotia | Nova Scotia Provincial Lotteries and Casino Corporation | false |
| PE | Prince Edward Island | PEI Lotteries Commission | false |
| NL | Newfoundland and Labrador | Department of Digital Government and Service NL | false |
| YT | Yukon | Department of Community Services | false |
| NT | Northwest Territories | Department of Municipal and Community Affairs | false |
| NU | Nunavut | Department of Community and Government Services | false |

---

## 3. Access Control & Permissions

### Who Can Do What

**Regular Users (org members):**
- Can ACCESS the Compliance tool (if their org has it enabled)
- Can CHAT with the Compliance agent
- Can VIEW cited sources and reference material
- Can VIEW their own past compliance conversations
- CANNOT view, edit, add, or delete knowledge base entries
- CANNOT see the compliance admin/management interface at all

**Org Admins:**
- Same as regular users — can use the tool but CANNOT manage knowledge base content
- CAN enable/disable the Compliance tool for their organization (feature toggle)

**Super Admin / Developer (Torin):**
- Full access to the Compliance Knowledge Base management UI
- Can ADD new knowledge base entries
- Can EDIT existing entries
- Can DEACTIVATE entries (soft delete)
- Can VERIFY entries (update last_verified_date)
- Can ACTIVATE/DEACTIVATE jurisdictions
- Can view analytics on what questions users are asking (future feature)

### Implementation Notes
- Add a `compliance_enabled` boolean flag to the organization settings
- The Compliance tool should only appear in the navigation for orgs where this is enabled
- The compliance knowledge base admin UI should only be accessible to super admin role — reuse whatever role/permission system already exists in Lightspeed for super admin access
- Do NOT add compliance knowledge base management to the regular admin dashboard — it gets its own dedicated section only visible to super admin

---

## 4. Backend API Endpoints

### Chat Endpoints

```
POST /api/compliance/chat
  Body: {
    conversation_id: (optional — null for new conversation),
    jurisdiction_code: "ON",
    message: "Can I sell raffle tickets online?"
  }
  Response: {
    conversation_id: "...",
    message: {
      role: "assistant",
      content: "...",
      citations: [
        {
          knowledge_base_id: "...",
          title: "Online Lottery Ticket Sales",
          source_name: "AGCO Registrar's Standards",
          source_url: "https://...",
          source_section: "Section 5.1",
          last_verified_date: "2026-03-15",
          excerpt: "The specific relevant passage..."
        }
      ],
      disclaimer: "..." (always present)
    }
  }

GET /api/compliance/conversations
  — List user's past compliance conversations

GET /api/compliance/conversations/:id
  — Get full conversation history with citations
```

### Knowledge Base Admin Endpoints (Super Admin Only)

```
GET    /api/compliance/admin/entries?jurisdiction=ON&category=Licensing
POST   /api/compliance/admin/entries
PUT    /api/compliance/admin/entries/:id
DELETE /api/compliance/admin/entries/:id  (soft delete — sets is_active: false)
POST   /api/compliance/admin/entries/:id/verify  (updates last_verified_date to now)

GET    /api/compliance/admin/jurisdictions
PUT    /api/compliance/admin/jurisdictions/:code  (activate/deactivate)
```

All admin endpoints must check for super admin role. Return 403 for anyone else.

---

## 5. AI Prompt System

### System Prompt for the Compliance Agent

The compliance agent needs a carefully crafted system prompt. This is critical — the agent must stay strictly within the knowledge base and never hallucinate regulatory information.

```
SYSTEM PROMPT:

You are the Lightspeed Compliance Assistant, a specialized AI tool that helps charitable lottery and raffle operators understand regulatory requirements in their jurisdiction.

CRITICAL RULES:
1. You ONLY answer questions based on the knowledge base content provided to you. If the answer is not in the provided knowledge base content, say: "I don't have specific guidance on that topic for [jurisdiction] in my current knowledge base. We recommend reaching out directly to [regulatory body name] for guidance on this."
2. You NEVER make up, guess, or infer regulatory information. If you're not certain, say so.
3. You NEVER provide legal advice. You provide regulatory guidance and information only.
4. You ALWAYS cite which knowledge base entry/entries your answer is based on. Use the format [Citation: entry_id] inline so the system can link to sources.
5. You keep answers clear, practical, and in plain language. Operators are not lawyers — they need actionable guidance.
6. You ALWAYS stay scoped to the user's selected jurisdiction. Never reference rules from other provinces unless the user explicitly asks for a comparison.
7. If a question is outside the scope of lottery/raffle/gaming compliance, politely redirect: "I'm specifically designed to help with lottery and raffle regulatory compliance. For other questions, I'd recommend [appropriate resource]."

JURISDICTION CONTEXT:
The user is operating in: {jurisdiction_name}
Regulatory body: {regulatory_body_name}
Regulatory website: {regulatory_body_url}

KNOWLEDGE BASE CONTENT:
{Retrieved knowledge base entries relevant to the user's question — use semantic search or keyword matching to pull the most relevant entries for the jurisdiction}

EVERY response must end with this exact disclaimer:
"⚠️ Disclaimer: This guidance is based on {regulatory_body_name} regulations as of {latest_verified_date_among_cited_entries}. Regulations can change — we recommend reaching out to a representative of {regulatory_body_name} ({regulatory_body_url}) to verify current requirements. Lightspeed provides regulatory guidance only and is not a substitute for professional legal advice. AI can make mistakes."
```

### How to Retrieve Relevant Knowledge Base Entries

When a user sends a message:
1. Take the user's question
2. Query the compliance_knowledge_base table filtered by the user's `jurisdiction_code` and `is_active: true`
3. Use keyword matching or semantic similarity to find the most relevant entries (start with keyword matching — semantic search can come later)
4. Pass the top 5-10 most relevant entries into the system prompt as context
5. The AI generates a response citing specific entries
6. Parse the [Citation: entry_id] tags from the response to build the citations array in the API response

### Multi-Turn Conversation

- Send the full conversation history (all previous messages in this conversation) with each request so the AI has context
- The jurisdiction is locked per conversation — don't let it change mid-conversation
- Keep conversations focused — if a user asks about a completely different topic, the AI should still scope to the same jurisdiction

---

## 6. Frontend UI — Split-Screen Chat Interface

This is the most important part of the user experience. The UI should resemble a modern AI chat interface (similar to Claude's web interface) with a split-screen layout.

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Compliance Assistant                    [Jurisdiction: ON] │
├─────────────────────────────┬───────────────────────────────┤
│                             │                               │
│      CHAT PANEL (LEFT)      │    REFERENCE PANEL (RIGHT)    │
│         ~60% width          │        ~40% width             │
│                             │                               │
│  ┌───────────────────────┐  │  ┌─────────────────────────┐  │
│  │ User message bubble   │  │  │ Source Card              │  │
│  └───────────────────────┘  │  │                          │  │
│                             │  │ Title: Online Sales Regs │  │
│  ┌───────────────────────┐  │  │ Source: AGCO Standards   │  │
│  │ AI response with      │  │  │ Section: 5.1             │  │
│  │ inline citation       │  │  │ Verified: Mar 15, 2026   │  │
│  │ markers [1] [2]       │  │  │ Status: ● Current        │  │
│  │                       │  │  │                          │  │
│  │ ⚠️ Disclaimer text    │  │  │ Excerpt:                 │  │
│  └───────────────────────┘  │  │ "The relevant passage    │  │
│                             │  │  from the knowledge base  │  │
│                             │  │  entry..."               │  │
│                             │  │                          │  │
│                             │  │ [View on AGCO website →] │  │
│                             │  └─────────────────────────┘  │
│                             │                               │
│                             │  ┌─────────────────────────┐  │
│                             │  │ Source Card 2            │  │
│                             │  │ ...                      │  │
│                             │  └─────────────────────────┘  │
│                             │                               │
├─────────────────────────────┴───────────────────────────────┤
│  [💬 Ask about compliance in Ontario...]          [Send ➤]  │
└─────────────────────────────────────────────────────────────┘
```

### Header Bar
- Title: "Compliance Assistant" with a shield or legal icon
- Jurisdiction selector dropdown in the top right — shows current province, lets user switch
- When switching jurisdiction, start a new conversation (don't mix jurisdictions in one thread)
- Show the regulatory body name under the jurisdiction (e.g., "Ontario — AGCO")
- If a jurisdiction is inactive (no content yet), show it greyed out in the dropdown with "Coming soon" label

### Chat Panel (Left Side — ~60% width)
- Modern chat interface with message bubbles
- User messages: right-aligned, brand-colored background
- AI responses: left-aligned, light/neutral background
- AI responses should have inline citation markers — small numbered badges like [1], [2] that correspond to the source cards in the right panel
- Clicking a citation marker scrolls the right panel to that source card and briefly highlights it
- The disclaimer appears at the bottom of every AI response, slightly muted/smaller text but always visible
- Show a typing indicator / loading animation while the AI is generating a response
- Chat input at the bottom with a text field and send button
- Placeholder text in input: "Ask about compliance in [jurisdiction name]..."
- Support Enter to send, Shift+Enter for new line
- Conversation history scrolls — new messages appear at the bottom

### Reference Panel (Right Side — ~40% width)
- This panel shows the sources cited in the most recent AI response
- When no sources are cited yet (start of conversation), show a friendly empty state: "Sources and references will appear here when the Compliance Assistant cites regulatory content."
- Each cited source is a card containing:
  - **Title** of the knowledge base entry
  - **Source name** (e.g., "AGCO Registrar's Standards for Lottery Licensing")
  - **Section reference** if available (e.g., "Section 4.2")
  - **Last verified date** with a freshness indicator:
    - Green dot + "Current" if verified within 90 days
    - Yellow dot + "Verify recommended" if 90-180 days old
    - Red dot + "May be outdated" if over 180 days old
  - **Excerpt** — the specific passage from the knowledge base that was referenced (not the whole entry)
  - **"View on [regulatory body] website →"** link that opens the source_url in a new tab
  - **"View full entry"** expandable section to see the complete knowledge base entry if the user wants more context
- Citation cards should have a numbered badge [1], [2] matching the inline markers in the chat
- When a new AI response comes in with different citations, the right panel updates to show the new sources (with a smooth transition, not a jarring swap)

### Responsive / Mobile Behavior
- On mobile or narrow screens, the reference panel should collapse into an expandable bottom sheet or overlay
- Show a "View sources (3)" button below the AI response that opens the reference panel
- The chat experience should still work perfectly on mobile — the split screen is a desktop enhancement

### Conversation History
- Add a sidebar or dropdown that shows past compliance conversations (like Claude's conversation list)
- Each past conversation shows: first question asked, jurisdiction, date
- User can click to reopen a past conversation and continue it or reference it
- Keep this simple — a collapsible left sidebar or a "Past conversations" button that opens a list

### Visual Design
- Match Lightspeed's existing design system (colors, fonts, border-radius, spacing)
- The chat interface should feel modern and clean — take cues from Claude's web UI
- Use the same modal system, toast notifications, and UI components from the premium polish work
- The split-screen divider should be clean — a subtle vertical line or slight shadow, not a heavy border
- Smooth animations: messages appearing, citation panel updating, typing indicator

---

## 7. Disclaimer System

This is non-negotiable. Every single response from the Compliance agent must include a disclaimer. No exceptions.

### End-of-Response Disclaimer (appears after every AI response)

```
⚠️ Disclaimer: This guidance is based on [Regulatory Body Name] regulations as of [most recent verified date among cited sources]. Regulations can change — we recommend reaching out to a representative of [Regulatory Body Name] ([regulatory body URL]) to verify current requirements. Lightspeed provides regulatory guidance only and is not a substitute for professional legal advice. AI can make mistakes.
```

### Styling
- The disclaimer should be visually distinct from the response text — slightly smaller font, muted color, with the ⚠️ icon
- It should NOT be dismissable or hideable
- It should NOT be in a collapsible section — always fully visible
- Separate it from the response content with a subtle divider line

### First-Message Welcome Disclaimer

When a user opens the Compliance tool for the first time (or starts a new conversation), before they've asked anything, show a welcome message from the AI:

```
Welcome to the Lightspeed Compliance Assistant. I can help you understand regulatory requirements for charitable lotteries and raffles in [jurisdiction name], based on [regulatory body name] guidelines.

You can ask me about licensing requirements, reporting obligations, draw rules, prize limits, advertising regulations, online sales rules, and more.

A few important things to know:

• My knowledge base was last verified on [date]. Regulations can change at any time.
• I provide guidance based on regulatory documents — not legal advice.
• For official rulings or interpretations, always contact [regulatory body name] directly at [regulatory body URL].
• I can make mistakes. Always verify critical compliance decisions with your regulatory body or a legal professional.

What can I help you with?
```

### Stale Content Warning

If ANY of the knowledge base entries cited in a response have a `last_verified_date` older than 90 days, add an additional warning above the standard disclaimer:

```
⚠️ Note: Some of the regulatory information referenced in this response was last verified over [X] days ago. Regulations may have changed since then. We strongly recommend verifying current requirements with [Regulatory Body Name] before acting on this guidance.
```

---

## 8. Super Admin Knowledge Base Management UI

This is a separate admin interface, only accessible to super admin, for managing the compliance knowledge base content.

### Access
- Add a "Compliance KB" section to the super admin area (NOT the regular admin dashboard)
- This should be completely invisible to regular users and org admins

### Jurisdiction Management View
- List all 13 provinces/territories
- Show for each: name, code, regulatory body, number of knowledge base entries, active/inactive toggle
- Toggle to activate/deactivate a jurisdiction (inactive jurisdictions show as "Coming soon" in the user-facing dropdown)

### Knowledge Base Entry Management View
- Filter by jurisdiction and category
- Table/list showing all entries: title, category, jurisdiction, last verified date, freshness status badge, active/inactive
- Sort by: last verified date, category, title, date created
- Highlight entries that are overdue for verification (90+ days) in yellow, 180+ days in red

### Add/Edit Entry Form
- Jurisdiction (dropdown)
- Category (dropdown with predefined options: Licensing, Reporting, Online Sales, Draw Rules, Prize Limits, Advertising, Financial Requirements, General — but also allow custom categories)
- Title (text input)
- Content (large text area — this is the main regulatory guidance content, written in plain language)
- Source name (text input)
- Source URL (text input, validated as URL)
- Source section (text input, optional)
- Last verified date (auto-set to today on create, manually updatable)
- Active toggle

### Bulk Actions
- "Mark as verified" — select multiple entries and update all their last_verified_date to today
- "Deactivate" — select multiple entries and set is_active to false
- These are the main bulk operations needed for maintenance

### Dashboard / Overview
- Total entries by jurisdiction
- Entries needing verification (90+ days old)
- Entries critically overdue (180+ days old)
- Recently added/updated entries

---

## 9. Initial Content — Ontario (AGCO)

Populate the Ontario jurisdiction with knowledge base entries covering the key regulatory topics. This is the seed content to make the tool functional.

**IMPORTANT:** Do NOT copy-paste raw legislation. Write each entry in plain, practical language that a lottery operator would understand. Reference the specific AGCO sections/standards so the operator can look them up, but write the content as clear guidance.

**IMPORTANT:** Before writing ANY content, go to the AGCO website (agco.ca) and find the current versions of their lottery-related regulations, standards, and guidelines. Use the actual current content as your source. The key documents to find and reference are:
- AGCO Registrar's Standards for Lottery Licensing
- Ontario Lottery and Gaming Corporation Act
- Gaming Control Act
- Any AGCO lottery-related bulletins or policy updates

### Categories to Cover (create entries for each)

**Licensing**
- Types of lottery licences (raffle, bingo, break-open, sports draft)
- Who can apply for a lottery licence (eligible organizations)
- Licence application process and requirements
- Licence fees
- Licence amendments — when you need one and how to apply
- Licence duration and renewal
- Multi-jurisdictional considerations

**Financial Requirements & Reporting**
- Financial reporting obligations (what reports are due, when, to whom)
- Revenue and expense tracking requirements
- Trust account requirements
- Audit requirements for different lottery sizes
- Prize payout requirements and timelines

**Draw Rules & Operations**
- Draw procedures and supervision requirements
- Random number generation requirements
- Record keeping requirements
- Ticket printing and numbering standards
- Maximum ticket prices
- Progressive/rollover jackpot rules (50/50 specific)

**Prize Limits**
- Maximum prize values by licence type
- Prize board/structure requirements
- Unclaimed prize handling
- Prize payment methods and timelines

**Online Sales**
- Rules for selling lottery tickets online
- Electronic raffle requirements
- Website and platform requirements for online sales
- Age verification and geofencing requirements

**Advertising & Marketing**
- Advertising standards and restrictions
- Required disclaimers in lottery advertising
- Social media promotion rules
- Odds disclosure requirements
- Restrictions on targeting minors

**Staffing & Volunteers**
- Volunteer vs. paid staff rules for lottery operations
- Seller/retailer requirements and training
- Background check requirements
- Commission structures and limits

**Compliance & Enforcement**
- Common compliance violations and penalties
- Inspection and audit rights of AGCO
- Complaint processes
- Licence suspension and revocation

For each category, create as many entries as needed to cover the topic thoroughly. Each entry should be focused on one specific sub-topic (e.g., "Licence Amendment Requirements" is one entry, "Licence Fees" is a separate entry). This makes citations more precise.

Set all entries with:
- `jurisdiction_code: "ON"`
- `regulatory_body: "Alcohol and Gaming Commission of Ontario (AGCO)"`
- `last_verified_date: "2026-03-15"` (today)
- `verified_by: "Torin"`
- `is_active: true`
- Accurate `source_url` links to the actual AGCO web pages

---

## 10. Future Jurisdiction Template

When adding a new province later, follow this pattern:

1. Activate the jurisdiction in the jurisdictions table
2. Research the province's regulatory body and their lottery/gaming regulations
3. Create knowledge base entries following the same category structure as Ontario
4. Set all entries with accurate source URLs, today's date as last_verified_date
5. Test by asking the Compliance agent questions in the new jurisdiction
6. The UI automatically picks up the new jurisdiction once it's activated — no frontend changes needed

This is not something to build now — it's documentation for future expansion.

---

## 11. Guardrails

### Before Starting
- Git commit the current working state before making any changes
- Read through the existing codebase to understand the current DB schema, API patterns, authentication system, and frontend architecture before building anything
- This is a NEW tool — don't modify existing tools. Add new files, routes, and database tables alongside what's already there.

### Database Safety
- Create NEW tables for compliance data — never modify existing tables
- Add proper indexes on jurisdiction_code, category, and is_active for query performance
- All knowledge base queries should filter by `is_active: true` — never serve deactivated entries to users

### API Safety
- All compliance admin endpoints MUST check for super admin role before executing — return 403 for non-super-admin requests
- All compliance chat endpoints must verify the user belongs to an org with `compliance_enabled: true`
- Validate all inputs — jurisdiction codes must match valid codes, required fields must be present
- Rate limit the chat endpoint to prevent abuse (reasonable limit, e.g., 30 messages per minute per user)

### AI Safety
- The system prompt MUST be hardcoded server-side — never let it be modified from the frontend
- NEVER pass user input directly into the system prompt — it goes in the messages array only
- ALWAYS include the disclaimer in responses — if for any reason the disclaimer is missing, the backend should append it before sending to the frontend
- The backend should validate that cited knowledge base entry IDs actually exist and belong to the correct jurisdiction before including them in the response

### Frontend Safety
- The compliance knowledge base admin UI must not be accessible or navigable by non-super-admin users — check permissions both in routing AND in the component rendering
- The reference panel should only display data returned from the API — don't store or cache knowledge base content in the browser

### Testing After Build
After everything is built, do a full test:
1. As a regular user: Can I access the Compliance tool? Can I chat? Can I see sources? Can I NOT access the admin KB?
2. As an org admin: Same as regular user, plus can I toggle the feature on/off for my org?
3. As super admin: Can I access the KB admin? Can I add/edit/verify/deactivate entries? Can I activate jurisdictions?
4. Ask the Compliance agent a question that IS in the knowledge base — does it answer correctly with citations?
5. Ask the Compliance agent a question that is NOT in the knowledge base — does it say "I don't have guidance on that" instead of making something up?
6. Ask the Compliance agent a non-compliance question — does it redirect appropriately?
7. Does every single response have the disclaimer? Check at least 10 different responses.
8. Do the citation markers in the chat correctly link to the source cards in the right panel?
9. Does the stale content warning appear when citing entries older than 90 days?
10. On mobile, does the reference panel collapse properly?
11. Git commit the completed feature with a clear message.

---

## Mandatory Reminder

This text must appear at the end of EVERY Compliance agent response, without exception. It is non-negotiable and cannot be hidden, collapsed, or removed by any user:

**"We recommend you reach out to an agent or representative of your regulatory body for official guidance. Lightspeed is designed to provide general regulatory information and guidance only — it is not a substitute for professional legal advice, and like all AI tools, it can make mistakes. Always verify critical compliance decisions directly with your provincial regulator."**

This is in addition to the per-jurisdiction disclaimer that cites the specific regulatory body name, URL, and last verified date.
