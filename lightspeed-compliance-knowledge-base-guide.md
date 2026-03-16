# Lightspeed Compliance Tool — Knowledge Base Population Guide

This guide is for AFTER the Compliance tool has been built and is functional. The tool is built — now we need to fill it with content.

You will be given PDF files one at a time. Each PDF is a section of the AGCO Lottery Licensing Policy Manual (2025 edition). Your job is to read each PDF carefully and produce structured knowledge base entries that will be imported into the Compliance tool's database.

---

## The Golden Rule: Accuracy Over Everything

This is compliance content. Lottery operators will rely on this to understand their legal obligations. **Accuracy is non-negotiable.**

- The `original_text` field must contain the EXACT text from the AGCO document — word for word, no paraphrasing, no rewording, no summarizing
- The `plain_summary` field is a brief helper that explains what the regulation means in practice — this IS written in plain language, but it supplements the original text, it does not replace it
- If you're unsure about anything, flag it — don't guess
- Never combine or blend text from different sections into one `original_text` field — each entry should map to one specific section of the document

---

## Entry Structure

For each distinct topic or sub-topic in the PDF, create one knowledge base entry using this exact structure:

```json
{
  "jurisdiction_code": "ON",
  "jurisdiction_name": "Ontario",
  "regulatory_body": "Alcohol and Gaming Commission of Ontario (AGCO)",
  "category": "[see category list below]",
  "title": "[clear, specific title — e.g., '50/50 Draw Rules (Paper-Based)']",
  "original_text": "[EXACT text from the AGCO document, word for word. Include all sub-points, conditions, thresholds, and details. Do not paraphrase. Do not summarize. Do not skip content. Copy it exactly as written.]",
  "plain_summary": "[A brief 2-4 sentence plain-language explanation of what this regulation means in practice for a lottery operator. This helps the AI give conversational answers. Example: 'If you're running a paper-based 50/50 draw, the maximum ticket price is $X and you must have at least X bona fide members present at the draw. The draw must be conducted in a public setting.']",
  "source_name": "AGCO Lottery Licensing Policy Manual (2025)",
  "source_url": "https://www.agco.ca/lottery-and-gaming/lottery-licensing-policy-manual",
  "source_section": "[exact section number as printed in the document — e.g., '5.2.1(F)']",
  "last_verified_date": "2026-03-15",
  "verified_by": "Torin",
  "is_active": true
}
```

### Category Options

Choose the most appropriate category for each entry:

- **Licensing** — licence types, who can apply, application processes, fees, amendments, renewals, cancellations
- **Draw Rules** — how draws must be conducted, supervision requirements, RNG rules, procedures
- **Financial Requirements** — trust accounts, start-up costs, financial statements, audits, guarantees, revenue splits
- **Reporting** — what reports are due, when, to whom, what they must contain
- **Advertising** — ad standards, restrictions, required disclaimers, celebrity rules, media rules
- **Online Sales** — electronic raffle rules, online ticket sales, platform requirements, geofencing, age verification
- **Prizes** — prize limits, types of prizes allowed/prohibited, unclaimed prizes, prize structures
- **Staffing** — bona fide members, paid sellers, volunteers, conflict of interest, duties
- **Compliance & Enforcement** — violations, penalties, inspections, suspension/revocation, AGCO enforcement powers
- **Operations** — general operational requirements, record keeping, ticket standards, event procedures
- **Eligibility** — who qualifies, charitable classifications, eligible/ineligible organizations
- **Use of Proceeds** — how lottery money can/cannot be spent, eligible/ineligible expenses
- **Registration** — supplier registration, gaming-related supplier requirements, classes of registration
- **General** — anything that doesn't fit neatly into the above categories

If a section clearly spans two categories, pick the primary one. Don't create duplicate entries.

---

## How to Break Up Content Into Entries

### One entry per distinct topic or sub-topic

- If a section covers one specific rule or policy, that's one entry
- If a section has sub-sections (A), (B), (C) that cover different aspects of the same topic, you have a choice:
  - If the sub-sections are short and closely related, keep them as ONE entry with all sub-sections in the `original_text`
  - If the sub-sections are long and cover meaningfully different topics, split them into SEPARATE entries
- Use your judgment — the goal is that each entry is focused enough that the AI can cite it precisely, but not so granular that context is lost

### Examples of good entry scoping:

**Good — focused, citable:**
- "50/50 Draw Rules (Paper-Based)" — covers section 5.2.1(F) specifically
- "Electronic Raffle Paid Sellers" — covers section 5.3.1(a)(i) specifically
- "Catch the Ace Progressive Raffle Policies" — covers section 5.2.1(L)(i)

**Bad — too broad, hard to cite:**
- "All Raffle Rules" — cramming all of Chapter 5 into one entry
- "Chapter 3" — not a useful unit of content

**Bad — too granular, loses context:**
- Splitting a single paragraph into three separate entries

---

## Processing Workflow

When you receive a PDF section file, follow these steps:

### Step 1: Read the Entire Document
Read the full PDF from start to finish before creating any entries. Understand the structure, how sections relate to each other, and what the key topics are.

### Step 2: Create the Entries
Go through the document section by section and create entries. For each entry:
1. Copy the `original_text` EXACTLY from the document
2. Write a brief `plain_summary` explaining what it means in practice
3. Assign the correct `category`
4. Write a clear, specific `title`
5. Record the exact `source_section` number

### Step 3: Output as JSON Array
Output all entries as a single JSON array that can be imported into the database:

```json
[
  {
    "jurisdiction_code": "ON",
    "jurisdiction_name": "Ontario",
    "regulatory_body": "Alcohol and Gaming Commission of Ontario (AGCO)",
    "category": "Draw Rules",
    "title": "50/50 Draw Rules (Paper-Based)",
    "original_text": "[exact text from document]",
    "plain_summary": "[plain language explanation]",
    "source_name": "AGCO Lottery Licensing Policy Manual (2025)",
    "source_url": "https://www.agco.ca/lottery-and-gaming/lottery-licensing-policy-manual",
    "source_section": "5.2.1(F)",
    "last_verified_date": "2026-03-15",
    "verified_by": "Torin",
    "is_active": true
  },
  {
    "jurisdiction_code": "ON",
    ...
  }
]
```

### Step 4: Wait for Review
After outputting the entries, STOP. Do not import anything into the database yet. Torin will review the entries for accuracy and completeness. Only import after explicit approval.

---

## Section Processing Order

Process the PDF sections in this order (most important first):

| Priority | File | Why |
|----------|------|-----|
| 1 | `05_Raffles.pdf` | Core use case — 50/50, Catch the Ace, electronic raffles. Most users will ask about this. |
| 2 | `03_General_Lottery_Licensing_Policies.pdf` | Advertising rules, financial requirements, trust accounts — applies to all lottery types. |
| 3 | `11_Glossary.pdf` | Definitions and terminology — the AI needs this to understand and use terms correctly. |
| 4 | `01_Regulatory_Framework.pdf` | The legal foundation — Criminal Code, Gaming Control Act, roles of AGCO and municipalities. |
| 5 | `02_Eligibility_and_Use_of_Proceeds.pdf` | Who qualifies for a licence, how proceeds can be used. Large section — take your time. |
| 6 | `04_Bazaar_Licence.pdf` | Small section — bazaar-specific lottery events. |
| 7 | `06_Special_Occasion_Gaming.pdf` | Blackjack, fun nights — niche but some users will ask. |
| 8 | `07_Break_Open_Tickets.pdf` | Scratch tickets, seal cards — separate lottery type with its own rules. |
| 9 | `08_Fair_and_Exhibition_Gaming.pdf` | Small section — fair/exhibition specific. |
| 10 | `09_Bingo_Non_Pooling_Halls.pdf` | Large section — full bingo operations in non-pooling halls. |
| 11 | `10_Bingo_Pooling_Halls.pdf` | Bingo revenue model, pooling hall specific. |
| 12 | `00_Front_Matter_and_Introduction.pdf` | Last — mostly administrative. Pull any useful policy context if present. |

**You do NOT need to process all 12 in one session.** Do one section at a time, wait for review, then move to the next.

---

## Quality Checklist (Run After Each Section)

Before presenting the entries for review, verify:

- [ ] Every distinct policy/rule in the PDF has a corresponding entry
- [ ] All `original_text` fields are EXACT copies from the document — no paraphrasing
- [ ] All `source_section` references match the actual section numbers in the document
- [ ] All `plain_summary` fields are accurate and don't misrepresent the original text
- [ ] No entries combine content from different sections into one `original_text`
- [ ] Titles are clear and specific enough to distinguish entries from each other
- [ ] Categories are appropriate for each entry
- [ ] Dollar amounts, thresholds, percentages, and timelines are captured exactly as written
- [ ] The JSON is valid and properly formatted
- [ ] No content was skipped or overlooked

---

## Handling Edge Cases

**Tables in the PDF:** If the document contains tables (fee schedules, thresholds, etc.), include the table data in the `original_text` formatted as clearly as possible. Use a simple text table format or list the values explicitly.

**Cross-references:** If a section says "see section X.X.X for details," note this in the `plain_summary` (e.g., "See also the entry for section X.X.X which covers [topic]") but don't merge content from the referenced section.

**Repeated content:** Some content may appear in multiple chapters (e.g., advertising rules appear in both general policies and raffle-specific sections). Create entries for both — the raffle-specific version may have additional details. Note in the `plain_summary` if there's a general version elsewhere.

**Definitions within sections:** If a section defines a term inline (not in the glossary), include the definition in the entry's `original_text`. Also check if it exists in the glossary section and note any differences.

---

## Important Reminders

- This is a ONE SECTION AT A TIME process. Don't try to do multiple PDFs at once.
- NEVER import entries without Torin's explicit approval.
- When in doubt about how to scope an entry, err on the side of keeping more context together rather than splitting too granularly.
- The `original_text` is sacred — copy it exactly. The `plain_summary` is where you add value with interpretation.
- Every entry will potentially be cited by the Compliance AI agent when giving guidance to lottery operators. Make sure each entry is self-contained enough to be useful as a standalone reference.
