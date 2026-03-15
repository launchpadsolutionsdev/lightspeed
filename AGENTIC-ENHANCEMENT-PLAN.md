# Making Lightspeed MORE Agentic — Comprehensive Enhancement Plan

## Executive Summary

Lightspeed already has a **strong agentic foundation** — Ask Lightspeed uses Claude's tool_use API with 9 tools, a recursive agentic loop, confirmation flows for write actions, and a unified context injection pipeline serving all 5 tools. This document identifies **15 high-impact enhancements** that push Lightspeed from "AI tools with some agency" to "a truly autonomous AI teammate."

---

## Current Agentic Capabilities (What We Already Have)

### Strengths
| Capability | Status | Where |
|---|---|---|
| Tool Use (function calling) | ✅ 9 tools | `askLightspeed.js` TOOLS array |
| Recursive agentic loop | ✅ Multi-turn | `processResponse()` recursive calls |
| Write action confirmation | ✅ Calendar + KB | `confirm` SSE events |
| Unified context pipeline | ✅ 8 context layers | `promptBuilder.js` buildEnhancedPrompt() |
| Per-tool context config | ✅ Config-driven | `TOOL_CONTEXT_CONFIG` |
| Semantic search (RAG) | ✅ pgvector + Voyage | `embeddingService.js`, `semanticChunkSearch()` |
| 3-tier KB retrieval | ✅ Semantic→FTS→Fallback | `injectKnowledgeBase()` |
| Conversation memory | ✅ Org-wide semantic | `conversationMemory.js` |
| Cross-tool context | ✅ 72h window | `getCrossToolContext()` |
| Voice fingerprinting | ✅ Per-tool profiles | `voiceFingerprint.js` |
| Dynamic budget allocation | ✅ Complexity-based | `budgetAllocator.js` |
| Correction learning | ✅ Feedback loop | `fetchRelevantCorrections()` |
| File parsing (PDF/Excel/CSV) | ✅ In Ask Lightspeed | `parseUploadedFile()` |
| Streaming SSE responses | ✅ All tools | `streamResponse()` |
| Prompt injection defense | ✅ XML delimiters + regex | `sanitizeInquiry()`, `wrapUserContent()` |

### Gaps (What's Missing for True Agency)
| Missing Capability | Impact |
|---|---|
| No multi-step planning | Agent can't decompose complex tasks into steps |
| No parallel tool execution | Tools run sequentially, even when independent |
| No proactive suggestions | Agent only responds to explicit requests |
| No tool chaining across tools | Can't "analyze this → draft a report about it" in one flow |
| No autonomous error recovery | If a tool fails, it just reports the error |
| No scheduled/background tasks | Everything is synchronous request-response |
| No self-reflection/evaluation | Agent doesn't assess its own output quality |
| No delegation to specialized sub-agents | Single monolithic agent handles everything |
| No persistent task state | Each request starts fresh |
| No user preference learning | Doesn't adapt to individual user patterns |

---

## Enhancement Tier 1: Immediate Impact (1-2 weeks each)

### 1. Multi-Step Task Planning (Agentic Decomposition)

**What:** When the user asks for something complex ("Set up our Q3 draw campaign"), the agent should decompose it into steps, execute them sequentially, and report progress — rather than trying to do everything in a single tool call.

**Implementation:**
```
New tool: plan_and_execute
  - Claude generates a numbered plan
  - Each step maps to an existing tool call
  - Steps execute sequentially with progress SSE events
  - User can approve/modify the plan before execution
```

**Files to modify:**
- `askLightspeed.js`: Add `plan_and_execute` tool definition + executor
- Frontend: Add plan approval UI component

**Example flow:**
```
User: "Set up our Spring Draw 50/50 campaign for April"

Agent plan:
1. search_runway_events → check for existing April events
2. create_runway_events → add draw dates, deadline, ticket sales open
3. draft_content (email, campaign_mode) → 3-email sequence
4. draft_content (social, 3 variants) → Facebook posts for each milestone
5. save_to_knowledge_base → save draw details as FAQ

[Execute plan] [Modify plan] [Cancel]
```

**Why this matters:** Currently, the user must make 5 separate requests. A planning agent does it in one interaction.

---

### 2. Parallel Tool Execution

**What:** When the agent needs to call multiple independent tools, execute them in parallel instead of sequentially.

**Current problem:** `processResponse()` processes tool_use blocks one at a time in a `for` loop. If Claude calls `search_knowledge_base` AND `search_runway_events`, the second waits for the first to complete.

**Implementation:**
- Modify `processResponse()` to detect independent tool calls
- Use `Promise.all()` for read-only tools that don't depend on each other
- Keep sequential execution for write tools and tools that depend on prior results

**Files to modify:**
- `askLightspeed.js`: Refactor `processResponse()` to support parallel execution

**Impact:** ~50% faster responses for queries that trigger multiple searches.

---

### 3. Proactive Suggestions Engine

**What:** After completing an action, suggest logical next steps. After generating a response, suggest related actions.

**Implementation:**
```javascript
// New SSE event type: 'suggestions'
sendEvent({
  type: 'suggestions',
  items: [
    { label: 'Draft follow-up email', action: 'draft_content', params: {...} },
    { label: 'Add to calendar', action: 'create_runway_events', params: {...} },
    { label: 'Save to KB', action: 'save_to_knowledge_base', params: {...} }
  ]
});
```

**Suggestion logic (rule-based + contextual):**
- After drafting an email → suggest creating matching social posts
- After analyzing data → suggest drafting a report or board summary
- After answering a customer question → suggest saving the answer to KB
- After creating calendar events → suggest drafting announcement content
- After a KB search returns no results → suggest creating a KB entry

**Files to modify:**
- `askLightspeed.js`: Add suggestion generation after each tool execution
- Frontend: Render clickable suggestion chips below responses

---

### 4. Self-Evaluation and Auto-Refinement

**What:** After generating a response, run a lightweight quality check and auto-refine if issues are detected — before showing the user.

**Implementation:**
- After the main response, run the existing `validateOutput()` + `validateFormatCompliance()`
- If violations are detected (Facebook response > 400 chars, email missing sign-off, etc.), automatically re-generate with a correction prompt
- Limit to 1 auto-refinement to prevent loops
- Show the user a subtle "Refined for format compliance" indicator

**Files to modify:**
- `askLightspeed.js`: Add post-generation validation + refinement loop
- `tools.js` (response assistant): Add auto-refinement for format violations

**Current gap:** `validateFormatCompliance()` already detects issues but only logs warnings. Making it trigger auto-correction closes the loop.

---

### 5. Tool Chaining (Cross-Tool Workflows)

**What:** Allow Ask Lightspeed to chain tools together in a single conversation turn, where the output of one tool feeds into the next.

**Current limitation:** The recursive `processResponse()` loop already handles multi-turn tool calls, but Claude doesn't naturally chain tools because the tool results are text summaries, not structured data.

**Enhancement:**
- When `run_insights_analysis` returns analysis, make the result available as structured data for `draft_content`
- When `search_response_history` returns past content, make it available for `draft_content` to iterate on
- Add a new tool: `compose_workflow` that lets Claude explicitly declare a chain

**Example:**
```
User: "Analyze our Q1 seller data and draft a board report about it"

Agent:
1. run_insights_analysis(data) → structured analysis
2. draft_content(content_type="write-anything", preset="board-report",
     inquiry="Board report on Q1 seller performance",
     details=analysis_from_step_1)
```

**Files to modify:**
- `askLightspeed.js`: Modify tool result passing to preserve structured data between chained calls

---

## Enhancement Tier 2: High Impact (2-4 weeks each)

### 6. Specialized Sub-Agents with Delegation

**What:** Instead of one monolithic Ask Lightspeed agent, create specialized sub-agents that the main agent can delegate to.

**Architecture:**
```
Ask Lightspeed (Orchestrator)
  ├── Content Strategist Agent (drafting + brand voice)
  ├── Data Analyst Agent (insights + reporting)
  ├── Knowledge Manager Agent (KB curation + gap detection)
  └── Campaign Planner Agent (calendar + multi-channel campaigns)
```

**Implementation:**
- Each sub-agent has its own system prompt optimized for its domain
- The orchestrator decides which sub-agent to invoke based on user intent
- Sub-agents inherit the unified context pipeline but with domain-specific tuning
- Sub-agents can use the model best suited for their task (Haiku for KB search, Sonnet for drafting)

**Benefits:**
- Better quality: each agent is expert in its domain
- Cost efficiency: use Haiku for simple tasks, Sonnet/Opus for complex ones
- Parallelism: sub-agents can work simultaneously

**Files to create:**
- `backend/src/agents/orchestrator.js`
- `backend/src/agents/contentStrategist.js`
- `backend/src/agents/dataAnalyst.js`
- `backend/src/agents/knowledgeManager.js`
- `backend/src/agents/campaignPlanner.js`

---

### 7. Persistent Task State (Agent Memory)

**What:** Allow the agent to track multi-step projects across sessions.

**Current limitation:** Every request to `/api/ask-lightspeed/agent` starts fresh. If a user says "continue setting up the Spring campaign we started yesterday," the agent has no memory of the project.

**Implementation:**
```sql
CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title VARCHAR(200),
  status VARCHAR(20) DEFAULT 'active', -- active, paused, completed
  plan JSONB, -- structured task plan with step statuses
  context JSONB, -- accumulated context from tool executions
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

- Agent can create, update, and resume tasks
- Tasks store the plan + accumulated tool results
- New tool: `manage_task` (create/update/resume/complete)
- Cross-session continuity via conversation memory already retrieves these

**Files to modify/create:**
- New migration for `agent_tasks` table
- `askLightspeed.js`: Add `manage_task` tool
- `conversationMemory.js`: Include active tasks in context

---

### 8. Autonomous KB Gap Detection and Curation

**What:** The agent proactively identifies and fills knowledge base gaps.

**Current state:** `logKbGap()` in `promptBuilder.js` already logs when KB queries return no results. But nothing acts on these gaps.

**Enhancement:**
- New background job: periodically analyze `kb_gaps` table
- Group similar gap queries into topics
- Suggest new KB entries to admins (via Home Base or a dedicated UI)
- When a support response gets positive feedback, auto-suggest saving it as a KB entry
- New tool for Ask Lightspeed: `suggest_kb_improvements` that analyzes gaps and drafts entries

**Implementation:**
```javascript
// New tool: analyze_kb_gaps
{
  name: 'analyze_kb_gaps',
  description: 'Analyze recent Knowledge Base search gaps and suggest new entries to create',
  input_schema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'How many days of gaps to analyze (default 30)' }
    }
  }
}
```

**Files to modify:**
- `askLightspeed.js`: Add KB gap analysis tool
- New: `backend/src/services/kbGapAnalyzer.js`
- `promptBuilder.js`: Enhance gap logging with topic clustering

---

### 9. Smart Notification Agent (Home Base Integration)

**What:** The agent can post to Home Base on behalf of users and proactively notify the team about important events.

**New tools:**
```javascript
{
  name: 'post_to_home_base',
  description: 'Create a post on the team Home Base bulletin board',
  input_schema: {
    type: 'object',
    properties: {
      body: { type: 'string' },
      category: { type: 'string', enum: ['general', 'urgent', 'fyi', 'draw_update', 'campaign'] },
      pinned: { type: 'boolean' }
    },
    required: ['body', 'category']
  }
}
```

**Autonomous behaviors:**
- After creating calendar events → auto-post a draw_update to Home Base
- After a significant KB update → post an FYI
- When approaching a deadline (from calendar) → post an urgent reminder
- When data analysis reveals something notable → post insights summary

**Files to modify:**
- `askLightspeed.js`: Add `post_to_home_base` tool (with confirmation)
- `homeBase.js`: Add programmatic post creation endpoint

---

### 10. Response Assistant → Agentic Response Assistant

**What:** Upgrade Response Assistant from a single-shot prompt to an agentic flow with the same tool-use capabilities as Ask Lightspeed.

**Current state:** Response Assistant sends one prompt and gets one response. No tool use, no iterative refinement, no ability to search for additional context mid-response.

**Enhancement:**
- Add tools to Response Assistant: `search_knowledge_base`, `search_response_history`, `search_home_base`
- Agent can search for additional context if the initial KB injection doesn't cover the inquiry
- Agent can check past responses for similar inquiries to ensure consistency
- Agent can self-evaluate and refine before showing the user

**Implementation approach:**
- Modify `/api/response-assistant/generate` to use `claudeService.generateResponse()` with tools
- Add a lightweight `processResponseAssistantToolCalls()` function (read-only tools only)
- Keep the streaming UX — send `status` events when tools are being called

---

## Enhancement Tier 3: Strategic (1-2 months)

### 11. Scheduled Agent Tasks (Background Automation)

**What:** Let users schedule recurring agent tasks.

**Examples:**
- "Every Monday at 9am, summarize last week's response metrics and post to Home Base"
- "Every Friday, check if next week has any draws and draft reminder emails"
- "Daily at 6pm, check for new Shopify orders and flag anomalies"

**Implementation:**
- New table: `scheduled_tasks` with cron expression, task definition, last run
- Background worker (Node.js cron or separate process) triggers agent executions
- Results posted to Home Base or emailed to the user
- New tool: `schedule_task` for Ask Lightspeed

---

### 12. Multi-Agent Collaboration (Agent-to-Agent)

**What:** Agents can delegate work to other agents and synthesize results.

**Example flow:**
```
User: "Prepare our monthly marketing review"

Orchestrator:
  → Data Analyst: "Analyze this month's sales data" (parallel)
  → Content Strategist: "Summarize content performance" (parallel)
  → Knowledge Manager: "What KB gaps appeared this month?" (parallel)

  ← All agents return results

  → Content Strategist: "Draft a board report combining these findings"
```

---

### 13. User Preference Learning (Adaptive Agent)

**What:** The agent learns individual user preferences over time.

**Signals to track:**
- Which suggestions the user accepts/ignores
- Preferred tone settings per content type
- Preferred format for different report types
- Common tool chains the user performs
- Time-of-day patterns (morning = email drafting, afternoon = analysis)

**Storage:**
```sql
CREATE TABLE user_agent_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  preference_type VARCHAR(50), -- 'tone', 'format', 'workflow', 'suggestion'
  preference_data JSONB,
  confidence FLOAT DEFAULT 0.5, -- increases with consistent patterns
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### 14. Conversational Refinement Loops

**What:** When the agent produces content, enable iterative refinement without starting over.

**Current state:** Draft Assistant and Response Assistant produce output. If the user wants changes, they must re-generate from scratch or manually edit.

**Enhancement:**
- After generating content, the agent enters a "refinement mode"
- User can say "make it shorter", "more formal", "add a CTA"
- Agent applies the refinement to the existing output (not regenerating from scratch)
- Track the refinement chain for learning

**Implementation:**
- Store the generated content + context in a short-lived session cache
- New refinement-specific tool: `refine_content` that takes the previous output + modification instructions
- Lower token cost than full regeneration (send previous output as context, not the full KB/rules pipeline)

---

### 15. Extended Tool Ecosystem

**What:** Add more tools that make the agent capable of deeper platform integration.

**New tools to add:**

| Tool | Type | Description |
|---|---|---|
| `manage_response_rules` | Write | Create/update response rules from conversation |
| `export_content` | Read | Export drafted content to clipboard, download, or email |
| `analyze_team_performance` | Read | Pull team metrics from analytics dashboard |
| `manage_content_templates` | Write | Save drafts as reusable templates |
| `shopify_lookup` | Read | Look up specific orders, customers, products |
| `generate_report` | Read | Generate formatted PDF/HTML reports from analysis |
| `compare_versions` | Read | Compare two drafts or two response approaches |
| `translate_content` | Read | Translate drafted content to FR/ES |

---

## Implementation Roadmap

### Phase 1: Foundational Agentic Upgrades (Weeks 1-3)
- **Enhancement 2** (Parallel tool execution) — Quick win, immediate perf improvement
- **Enhancement 3** (Proactive suggestions) — High visibility, moderate effort
- **Enhancement 4** (Self-evaluation) — Builds on existing validation infrastructure
- **Enhancement 5** (Tool chaining) — Leverages existing recursive loop

### Phase 2: Planning & Memory (Weeks 4-6)
- **Enhancement 1** (Multi-step planning) — The biggest single agentic upgrade
- **Enhancement 7** (Persistent task state) — Enables cross-session continuity
- **Enhancement 8** (KB gap detection) — Leverages existing gap logging

### Phase 3: Expanded Agency (Weeks 7-10)
- **Enhancement 9** (Home Base posting) — Simple tool addition
- **Enhancement 10** (Agentic Response Assistant) — Significant upgrade
- **Enhancement 14** (Refinement loops) — Better UX
- **Enhancement 15** (Extended tools) — Incremental tool additions

### Phase 4: Advanced Architecture (Weeks 11+)
- **Enhancement 6** (Sub-agents) — Major architecture change
- **Enhancement 11** (Scheduled tasks) — Requires background worker
- **Enhancement 12** (Multi-agent collaboration) — Builds on sub-agents
- **Enhancement 13** (User preference learning) — Long-term intelligence

---

## Quick Win Candidates (< 1 day each)

These can be implemented immediately with minimal risk:

1. **Parallel tool execution** — Change `for` loop to `Promise.all()` for read tools
2. **Proactive suggestions** — Add suggestion SSE event after tool completions
3. **Auto-save positive responses to KB suggestion** — After thumbs-up, suggest saving
4. **KB gap surfacing** — Show recent gaps to admins in the KB management UI
5. **Tool call streaming** — Stream draft_content output instead of waiting for completion
6. **Cancel in-progress tool calls** — Add abort controller support to long-running tool executions

---

## Architecture Principles

1. **Human-in-the-loop for writes** — All write actions require confirmation. Never auto-execute destructive operations.
2. **Progressive disclosure** — Show the agent's plan/thinking only when the user wants depth. Default to concise.
3. **Graceful degradation** — If a sub-agent fails, fall back to the monolithic agent. If tool execution fails, report and suggest alternatives.
4. **Cost awareness** — Use Haiku for classification/routing, Sonnet for generation, Opus only when explicitly requested.
5. **Context efficiency** — The budget allocator already manages token budgets. Extend it to manage agent complexity budgets.
6. **Audit trail** — Every agent action should be logged to `usage_logs` with clear attribution.

---

## Metrics to Track

| Metric | Current | Target |
|---|---|---|
| Avg tool calls per session | ~1.2 | 3-5 (more autonomous workflows) |
| Multi-turn completion rate | N/A | >80% (agent completes multi-step tasks) |
| Suggestion acceptance rate | N/A | >30% (proactive suggestions are useful) |
| KB gap auto-fill rate | 0% | >20% (gaps automatically addressed) |
| Cross-tool workflow adoption | N/A | >15% of sessions use 2+ tools |
| Auto-refinement trigger rate | N/A | <10% (quality is good enough most of the time) |
