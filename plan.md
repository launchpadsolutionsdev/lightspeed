# Plan: Proactive Suggestions Engine (Enhancement #3)

## Overview

After the agent completes a tool call or generates a response, send contextual "next step" suggestions as clickable chips below the message. Users can click to execute the suggestion instantly.

---

## Backend Changes

### File: `backend/src/routes/askLightspeed.js`

#### 1. Add suggestion generator function (~70 lines)

Add `generateSuggestions(toolName, toolInput, toolResult)` after the tool executors (around line 675). Returns an array of 2-4 suggestion objects based on what just happened:

```js
function generateSuggestions(completedTool, toolInput, toolResult) {
  const suggestions = [];

  switch (completedTool) {
    case 'draft_content':
      if (toolInput.content_type === 'email')
        suggestions.push({ label: 'Draft matching social posts', icon: '📱', prompt: `Draft social media posts about the same topic: ${toolInput.inquiry}` });
      if (toolInput.content_type === 'social')
        suggestions.push({ label: 'Draft matching email', icon: '✉️', prompt: `Draft an email newsletter about the same topic: ${toolInput.inquiry}` });
      suggestions.push(
        { label: 'Add dates to calendar', icon: '📅', prompt: 'Add any dates or deadlines from this content to the Runway calendar' },
        { label: 'Save key info to KB', icon: '💾', prompt: 'Save the key facts from this draft to the Knowledge Base' }
      );
      if (toolInput.content_type === 'email')
        suggestions.push({ label: 'Draft ad copy', icon: '📣', prompt: `Create Facebook ad variants promoting the same campaign: ${toolInput.inquiry}` });
      break;

    case 'create_runway_events':
      suggestions.push(
        { label: 'Draft announcement email', icon: '✉️', prompt: 'Draft an announcement email about the events we just added to the calendar' },
        { label: 'Draft social posts', icon: '📱', prompt: 'Draft social media posts announcing the events we just scheduled' }
      );
      break;

    case 'search_runway_events':
      suggestions.push(
        { label: 'Draft content for these', icon: '✏️', prompt: 'Draft promotional content for the upcoming events' },
        { label: 'Add new events', icon: '➕', prompt: 'Add new events to the Runway calendar' }
      );
      break;

    case 'search_knowledge_base':
      if (toolResult && toolResult.includes('No matching'))
        suggestions.push({ label: 'Create KB entry for this', icon: '💾', prompt: 'Save an answer to this question in the Knowledge Base' });
      suggestions.push(
        { label: 'Draft a response using this', icon: '✉️', prompt: 'Draft a customer response using the information found' }
      );
      break;

    case 'save_to_knowledge_base':
      suggestions.push(
        { label: 'Add more to KB', icon: '💾', prompt: 'Save another piece of information to the Knowledge Base' },
        { label: 'Verify in KB', icon: '🔍', prompt: 'Search the Knowledge Base to verify the entry was saved correctly' }
      );
      break;

    case 'run_insights_analysis':
      suggestions.push(
        { label: 'Draft board report', icon: '📊', prompt: 'Draft a board report summarizing these analysis findings' },
        { label: 'Draft team update', icon: '📝', prompt: 'Write a team update post about these insights for Home Base' }
      );
      break;

    case 'search_response_history':
      suggestions.push(
        { label: 'Draft updated version', icon: '✏️', prompt: 'Draft an updated version of the most relevant past response' }
      );
      break;

    case 'search_home_base':
      suggestions.push(
        { label: 'Summarize key takeaways', icon: '📋', prompt: 'Summarize the key takeaways from these Home Base posts' }
      );
      break;
  }

  return suggestions.slice(0, 4);
}
```

#### 2. Add `generateTextSuggestions()` for no-tool responses (~20 lines)

Simple keyword-based detection when Claude responds without calling any tool:

```js
function generateTextSuggestions(text) {
  const suggestions = [];
  const lower = text.toLowerCase();
  if (lower.includes('draw') || lower.includes('jackpot') || lower.includes('prize'))
    suggestions.push({ label: 'Draft draw announcement', icon: '✉️', prompt: 'Draft an announcement email about this draw' });
  if (lower.includes('event') || lower.includes('schedule') || lower.includes('date'))
    suggestions.push({ label: 'Check Runway calendar', icon: '📅', prompt: 'Search the Runway calendar for related events' });
  if (lower.includes('policy') || lower.includes('procedure') || lower.includes('rule'))
    suggestions.push({ label: 'Search KB for policy', icon: '🔍', prompt: 'Search the Knowledge Base for related policies' });
  if (suggestions.length === 0)
    suggestions.push(
      { label: 'Search Knowledge Base', icon: '🔍', prompt: 'Search the Knowledge Base for more information about this' },
      { label: 'Draft content about this', icon: '✏️', prompt: 'Help me draft content about this topic' }
    );
  return suggestions.slice(0, 3);
}
```

#### 3. Emit `suggestions` SSE event in two places

**A. After tool execution completes** — at the end of each tool handler in `processResponse()`, after the recursive call resolves. Rather than modifying 8 branches, add a single emission point in the main `/agent` endpoint (around line 812), right before `sendEvent({ type: 'done' })`:

```js
// Collect the last tool used from the response
const lastToolUse = response.content?.find(b => b.type === 'tool_use');
if (lastToolUse) {
  const suggestions = generateSuggestions(lastToolUse.name, lastToolUse.input, '');
  if (suggestions.length > 0) sendEvent({ type: 'suggestions', items: suggestions });
} else {
  const textContent = response.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  const suggestions = generateTextSuggestions(textContent);
  if (suggestions.length > 0) sendEvent({ type: 'suggestions', items: suggestions });
}
```

**Problem with the above:** The recursive processResponse() loop means we don't know which tool was the *last* one executed. The recursive calls may call multiple tools.

**Better approach:** Track the last tool name through the recursive calls. Add a closure variable at the top of the `/agent` handler:

```js
let lastExecutedTool = null;
let lastToolInput = null;
```

In each tool execution branch of `processResponse()`, set these before recursing:
```js
lastExecutedTool = toolUse.name;
lastToolInput = toolUse.input;
```

Then after `processResponse()` returns in the main handler, emit suggestions based on the last tool. This keeps the emission in **one place** instead of 8.

---

## Frontend Changes

### File: `frontend/app.js`

#### 4. Handle `suggestions` SSE event in agentic handler (~5 lines)

In `sendAlsAgenticMessage()` (around line 3288, in the event type switch), add:

```js
} else if (event.type === 'suggestions') {
  alsPendingSuggestions = event.items;
```

Declare `let alsPendingSuggestions = null;` near the top of the function with the other state variables.

#### 5. Render suggestion chips after message completion (~20 lines)

After the agentic message finishes (around line 3295, after action buttons are appended), render suggestions:

```js
if (alsPendingSuggestions && alsPendingSuggestions.length > 0) {
  renderAlsSuggestions(msgDiv, alsPendingSuggestions);
}
```

Add the `renderAlsSuggestions()` function near the other ALS UI helpers (around line 4285):

```js
function renderAlsSuggestions(msgDiv, suggestions) {
  const existing = msgDiv.querySelector('.als-suggestions');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.className = 'als-suggestions';
  wrap.innerHTML = '<span class="als-suggestions-label">Suggested next steps</span>';
  suggestions.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'als-suggestion-chip';
    btn.textContent = (s.icon ? s.icon + ' ' : '') + s.label;
    btn.onclick = () => {
      wrap.remove();
      sendAlsMessage(s.prompt);
    };
    wrap.appendChild(btn);
  });
  msgDiv.appendChild(wrap);
}
```

---

## CSS Changes

### File: `frontend/index.html`

#### 6. Add suggestion chip styles (~25 lines)

Add within the existing `<style>` block for Ask Lightspeed (search for `.als-refinements` to find the right location):

```css
.als-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(0,0,0,0.06);
  align-items: center;
}
.als-suggestions-label {
  font-size: 11px;
  color: #8898aa;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  width: 100%;
  margin-bottom: 2px;
}
.als-suggestion-chip {
  background: #f0f4ff;
  border: 1px solid #d4deff;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 13px;
  color: #4a5568;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.als-suggestion-chip:hover {
  background: #dce4ff;
  border-color: #635BFF;
  color: #2d3748;
  transform: translateY(-1px);
}
```

---

## File Change Summary

| File | Changes | Effort |
|------|---------|--------|
| `backend/src/routes/askLightspeed.js` | Add `generateSuggestions()`, `generateTextSuggestions()`, tracking vars, emit `suggestions` SSE event | ~100 lines |
| `frontend/app.js` | Add `renderAlsSuggestions()`, handle `suggestions` event type, wire into completion flow | ~30 lines |
| `frontend/index.html` | Add `.als-suggestions` + `.als-suggestion-chip` CSS | ~25 lines |

## Design Decisions

- **Rule-based, not LLM-based** — Suggestions are deterministic from the tool that just ran. Zero extra API calls, zero latency, zero cost.
- **Max 4 suggestions** — Keeps UI clean.
- **Click-to-execute** — Clicking a chip sends the prompt immediately. No extra step.
- **Disappear on click** — Chip row removed after click to prevent stale suggestions.
- **One emission point** — Track last tool via closure variables, emit once before `done` event. Avoids modifying 8 tool handler branches.
- **Reuses existing UI pattern** — Styled like the existing `.als-refinements` chips (Shorter, Longer, etc.) but with a different color scheme (blue vs neutral) to visually distinguish "next steps" from "edit this response."
