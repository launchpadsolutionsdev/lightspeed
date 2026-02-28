# What's New Page — Implementation Plan

## Overview
Add a "What's New" page accessible from the landing page navigation bar. The page follows Anthropic's announcement style: a clean, chronological list of feature releases, each linking to a dedicated detail page with a media-release-style writeup.

## Architecture

Since Lightspeed is a vanilla JS/HTML/CSS static site (no framework, no build step), we follow the same pattern as `case-study.html`:

### New Files
1. **`frontend/whats-new.html`** — The index/listing page showing all announcements
2. **`frontend/whats-new.css`** — Styles for both the listing and detail pages
3. **`frontend/whats-new/shopify-integration.html`** — Detail page for Shopify integration
4. **`frontend/whats-new/ask-lightspeed-upgrade.html`** — Detail page for Ask Lightspeed major upgrade
5. **`frontend/whats-new/rules-of-play.html`** — Detail page for Rules of Play Generator
6. **`frontend/whats-new/multilingual-support.html`** — Detail page for French & Spanish language support
7. **`frontend/whats-new/streaming-responses.html`** — Detail page for streaming AI responses
8. **`frontend/whats-new/microsoft-auth.html`** — Detail page for Microsoft 365 sign-in
9. **`frontend/whats-new/draft-assistant-redesign.html`** — Detail page for Draft Assistant writing studio
10. **`frontend/whats-new/agent-instructions.html`** — Detail page for Agent Instructions & Instruction Chips
11. **`frontend/whats-new/onboarding-wizard.html`** — Detail page for 5-step onboarding wizard

### Modified Files
1. **`frontend/index.html`** — Add "What's New" link to landing nav bar
2. **`frontend/case-study.html`** — Add "What's New" link to its nav bar for consistency

## Feature Releases to Highlight (9 major features, chronological)

| # | Date | Title | Category |
|---|------|-------|----------|
| 1 | Feb 10, 2026 | Microsoft 365 Sign-In | Platform |
| 2 | Feb 10, 2026 | Agent Instructions & Quick Chips | AI |
| 3 | Feb 13, 2026 | Draft Assistant Writing Studio | Tools |
| 4 | Feb 15, 2026 | Multilingual Support: French & Spanish | AI |
| 5 | Feb 15, 2026 | Real-Time Streaming Responses | AI |
| 6 | Feb 15, 2026 | Rules of Play Generator | Tools |
| 7 | Feb 17, 2026 | Ask Lightspeed Major Upgrade | Tools |
| 8 | Feb 23, 2026 | 5-Step Onboarding Wizard | Platform |
| 9 | Feb 27, 2026 | Shopify Integration | Integrations |

## Design Approach (Anthropic-inspired)

### Listing Page (`whats-new.html`)
- **Nav bar**: Same as landing page with "What's New" link highlighted as active
- **Hero section**: Clean header with title "What's New" and a subtitle
- **Feed**: Reverse-chronological list of announcement cards
- Each card shows:
  - **Date** (formatted like "February 15, 2026")
  - **Category badge** (e.g., "AI", "Tools", "Platform", "Integrations")
  - **Title** (clickable, links to detail page)
  - **One-line summary**
- Clean, minimal design with generous whitespace (Stripe/Anthropic aesthetic)

### Detail Pages (`whats-new/*.html`)
Each detail page follows a "media release" format:
- **Back link**: "← Back to What's New"
- **Hero**: Category badge + date + headline title
- **Body**:
  - Opening paragraph (the "lede" — what it is, why it matters)
  - "What's included" / "Key features" section with bullet points
  - "How it works" section with usage details
  - "What's next" closing paragraph
- **Footer CTA**: "Try it now" button linking to the app
- Same nav bar as the listing page

### Visual Style
- Matches existing design system (Inter font, CSS variables from design-system.css)
- Cards with subtle borders and hover lift (consistent with landing page)
- Category badges use brand gradient colors
- Generous padding, max-width 860px for readability
- Responsive at 768px breakpoint

## Implementation Steps

1. Create `frontend/whats-new/` directory for detail pages
2. Create `frontend/whats-new.css` with all styles
3. Create `frontend/whats-new.html` listing page
4. Create all 9 detail pages in `frontend/whats-new/`
5. Add "What's New" link to nav in `frontend/index.html`
6. Add "What's New" link to nav in `frontend/case-study.html`
7. Test navigation flow between all pages
