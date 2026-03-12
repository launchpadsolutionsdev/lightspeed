# Ask Lightspeed — Follow-Up Tweaks

## Prompt for Claude Code

Paste the following into Claude Code:

---

I need a few follow-up tweaks to the Ask Lightspeed system prompt changes we just made. These are refinements based on reviewing the assembled output.

### 1. Fix Citation Format Mismatch

In `backend/src/services/promptBuilder.js`, the KB entries are labeled `[Source 1]`, `[Source 2]`, etc., but the CITATION RULES section tells the model to cite using `[1]`, `[2]`. Make these consistent — update the CITATION RULES to reference `[Source 1]`, `[Source 2]` format so it matches the actual KB entry labels. The updated instruction should read something like:

```
CITATION RULES: When your response uses information from the knowledge base sources above, include inline citations using the format [Source 1], [Source 2], etc. corresponding to the source numbers. Only cite when you directly use information from a specific source. Do not cite for general knowledge.
```

### 2. Clarify Security vs Citation Interaction

In the SECURITY section in `frontend/app.js`, add a clarifying line at the end of the security block:

```
- Citing knowledge base information in responses to user questions is expected behavior and is not a security concern — the restriction is on revealing raw system configuration, not on using knowledge base content to help users
```

### 3. Add Token Efficiency Guidance

In the CORE BEHAVIOR section in `frontend/app.js`, add the following line after the existing paragraph about responding directly:

```
Be efficient with your responses — avoid unnecessary preamble, repetition, or filler. Get to the point quickly. This applies to all model tiers.
```

### 4. Move Tone Variable to Layer 2 for Better Prompt Caching

This is the most involved change. Right now the `${toneDesc}` variable is injected directly into the Layer 1 base prompt, which means any tone change busts the prompt cache on the entire base block. Since you have prompt caching enabled via `cache_control: { type: 'ephemeral' }`, we want the static portions of Layer 1 to stay identical across requests so the cache actually hits.

Here's what to do:

**In the Layer 1 base prompt (`app.js`),** replace the dynamic tone block:

```
TONE: ${toneDesc}
- Use clear, concise language appropriate for nonprofit professionals
...
```

With a static version:

```
TONE: See dynamic tone configuration below.
- Use clear, concise language appropriate for nonprofit professionals
- Use contractions and a natural voice — avoid sounding robotic or overly formal
- Do not use emojis unless the user does first
- Match the user's energy — if they're brief, be brief; if they're detailed, be thorough
- For customer-facing response drafts: keep them under 150 words unless the user specifies otherwise
- For internal/operational responses: be as detailed as needed
```

**Then in Layer 2 (the dynamic sections appended after the base prompt),** prepend the tone setting before the Knowledge base section:

```
TONE SETTING: Respond in a ${toneDesc} tone. This overrides the default tone guidance above.
```

This way the entire Layer 1 base prompt is static and cacheable, and the tone variation lives in Layer 2 alongside the other dynamic content.

**Do the same for the language instruction** — if `${getLanguageInstruction()}` is currently injected into Layer 1, move it to Layer 2 as well, right after the tone setting. The Layer 1 base prompt should contain zero dynamic variables once this is done. The `${orgName}` in the first line ("You work for ${orgName}") should also be moved — replace it with a placeholder in Layer 1 like "You work for the organization identified below." and then inject the actual org name at the top of Layer 2:

```
ORGANIZATION: ${orgName}
TONE SETTING: Respond in a ${toneDesc} tone.
${getLanguageInstruction()}

Knowledge base:
...
```

The goal is: Layer 1 = 100% static text, zero variables, maximum cache hits. Layer 2 = all dynamic content (org name, tone, language, draw schedule, rated examples). Layer 3 = server-side injections (unchanged).

---

After making all changes, show me the updated Layer 1 base prompt and the beginning of Layer 2 so I can confirm the static/dynamic split is clean. Also confirm that the prompt caching in `backend/src/services/claude.js` is still applied to the correct portion.
