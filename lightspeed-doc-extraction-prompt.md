# Claude Code Prompt: Lightspeed Documentation Extraction

Paste the following into Claude Code:

---

I need you to do a comprehensive audit of this codebase to extract all the information needed to produce two user manuals for Lightspeed:

1. **End-User Manual** — for charitable lottery operators using the platform day-to-day
2. **Technical Manual** — for a development team evaluating the platform for acquisition

Please go through the entire codebase and produce a single structured markdown file called `lightspeed-doc-context.md` that covers the following:

## Part 1: Product Overview
- What is Lightspeed? (extract from any landing pages, about pages, README, or marketing copy)
- What problem does it solve?
- Who is the target user?

## Part 2: Feature Inventory
For EVERY user-facing feature/tool in the platform, document:
- **Feature name** (as it appears in the UI)
- **Location in the app** (navigation path — e.g., sidebar > Compliance)
- **Purpose** — what does it do, in plain language?
- **Key functionality** — what can the user actually do with it? List every action, button, form, and workflow
- **Inputs** — what does the user provide?
- **Outputs** — what does the user get back?
- **Any configuration or settings available**
- **File paths** — which source files power this feature (components, pages, API routes)

Be thorough. Check every route, every sidebar/nav item, every page component. Known tools include (but may not be limited to):
- Ask Lightspeed
- Compliance Assistant
- Runway (Content Calendar)
- Home Base
- Insights Engine
- Response Assistant
- Draft Assistant
- List Normalizer
- Rules of Play Generator
- Shopify Analytics Dashboard
- Any settings, profile, or admin pages

## Part 3: User Workflows
- What does the onboarding/signup flow look like?
- What does a user see when they first log in?
- What are the main workflows a user would follow day-to-day?
- Are there any role-based permissions or multi-user features?

## Part 4: Technical Architecture (for the technical manual)
- **Tech stack**: frameworks, languages, major libraries
- **Project structure**: high-level folder organization
- **Authentication**: how does auth work? (OAuth, sessions, etc.)
- **Database**: what database is used? What are the main data models/schemas?
- **API layer**: REST or other? List key API routes and what they do
- **AI/LLM integration**: how is Claude/AI used? System prompts, tool use, agentic patterns, prompt caching, etc.
- **External integrations**: Shopify, Mailchimp, any other third-party services
- **Deployment**: how is it hosted/deployed?
- **Environment variables**: list all env vars (names only, no values) and what each one configures
- **Any security considerations**: rate limiting, data handling, compliance

## Part 5: UI & Navigation
- What does the main navigation structure look like? (sidebar items, top bar, etc.)
- Describe the overall layout and design language
- Are there any modals, tooltips, onboarding guides, or help text built into the UI?

## Part 6: Content & Data
- Is there a knowledge base or pre-loaded content? What does it contain?
- Are there any sample/demo data sets?
- What jurisdictions or regulatory bodies are covered in the compliance tool?

## Output Instructions
- Save the output as `lightspeed-doc-context.md` in the project root
- Use clear markdown headings and structure
- Be as specific and detailed as possible — quote UI text, button labels, placeholder text exactly as they appear
- If you're unsure about something, flag it with a ⚠️ and your best guess
- Do NOT skip any features — if it exists in the codebase, document it
