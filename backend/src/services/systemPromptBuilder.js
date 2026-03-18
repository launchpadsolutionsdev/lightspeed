/**
 * System Prompt Builder Service
 *
 * Centralizes all prompt template construction that was previously in
 * frontend/app.js. The frontend now sends only parameters (tone, format,
 * language, etc.) and the backend assembles the complete system prompt.
 *
 * This eliminates prompt exposure in browser dev tools and creates a
 * single source of truth for all prompt templates.
 */

const pool = require('../../config/database');
const { pickRelevantRatedExamples, pickRelevantKnowledge } = require('./claude');
const log = require('./logger');

// ─── Input sanitization ─────────────────────────────────────────────

const MAX_INQUIRY_LENGTH = 10000;
const MAX_THREAD_LENGTH = 20000;

const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /disregard\s+(all\s+)?prior\s+(instructions|context)/gi,
    /you\s+are\s+now\s+(a|an)/gi,
    /reveal\s+(the\s+)?(system\s+)?prompt/gi,
    /output\s+(the\s+)?(full\s+)?(system\s+)?prompt/gi,
    /repeat\s+(the\s+)?instructions\s+above/gi,
    /what\s+(are|were)\s+your\s+(system\s+)?instructions/gi,
];

/**
 * Sanitize user-provided inquiry text against prompt injection.
 * Logs when patterns are detected for monitoring.
 */
function sanitizeInquiry(text, maxLength = MAX_INQUIRY_LENGTH) {
    if (!text) return '';

    let sanitized = text.substring(0, maxLength);

    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(sanitized)) {
            log.warn('Prompt injection pattern detected', { pattern: pattern.toString(), tag: 'security' });
            sanitized = sanitized.replace(pattern, '[filtered]');
        }
    }

    return sanitized;
}

/**
 * Wrap user-provided content in XML delimiters so the model can
 * distinguish user content from system instructions.
 */
function wrapUserContent(tag, content) {
    return `<${tag}>\n${content}\n</${tag}>`;
}

// ─── Language instructions ───────────────────────────────────────────

const LANGUAGE_INSTRUCTIONS = {
    en: '',
    fr: '\nLANGUAGE: You MUST write your entire response in French (Français). The customer inquiry may be in any language, but your response must always be in French.\n',
    es: '\nLANGUAGE: You MUST write your entire response in Spanish (Español). The customer inquiry may be in any language, but your response must always be in Spanish.\n'
};


// ─── Calendar events context builder ─────────────────────────────────

/**
 * Fetch upcoming calendar events (next 30 days) for an organization
 * and format them as a concise context block for AI tools.
 */
async function buildCalendarContext(organizationId, options = {}) {
    try {
        const days = options.days || 30;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const future = new Date(today);
        future.setDate(future.getDate() + days);
        const futureStr = future.toISOString().split('T')[0];

        const result = await pool.query(
            `SELECT id, title, description, event_date, event_time, end_time,
                    all_day, category, recurrence_rule, recurrence_end_date
             FROM calendar_events
             WHERE organization_id = $1
               AND event_date <= $3
               AND (recurrence_rule IS NOT NULL OR event_date >= $2)
             ORDER BY event_date ASC, event_time ASC NULLS FIRST`,
            [organizationId, todayStr, futureStr]
        );

        if (result.rows.length === 0) return '';

        // Normalize event_date from pg Date objects to YYYY-MM-DD strings
        for (const row of result.rows) {
            if (row.event_date instanceof Date) {
                row.event_date = row.event_date.toISOString().split('T')[0];
            }
            if (row.recurrence_end_date instanceof Date) {
                row.recurrence_end_date = row.recurrence_end_date.toISOString().split('T')[0];
            }
        }

        // Expand recurring events
        const allEvents = [];
        for (const event of result.rows) {
            if (event.recurrence_rule) {
                const instances = expandRecurringForRange(event, todayStr, futureStr);
                allEvents.push(...instances);
            } else {
                allEvents.push(event);
            }
        }

        // Sort by date and time, cap at 20
        allEvents.sort((a, b) => {
            const dateComp = (a.event_date || '').localeCompare(b.event_date || '');
            if (dateComp !== 0) return dateComp;
            return (a.event_time || '').localeCompare(b.event_time || '');
        });
        const capped = allEvents.slice(0, 20);

        if (capped.length === 0) return '';

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        let context = 'UPCOMING CALENDAR EVENTS (next 30 days):\n';
        for (const ev of capped) {
            const d = new Date(ev.event_date + 'T00:00:00');
            const dayName = dayNames[d.getDay()];
            const monthName = monthNames[d.getMonth()];
            const dayNum = d.getDate();

            let line = `- ${dayName} ${monthName} ${dayNum}: ${ev.title}`;
            if (ev.category) line += ` [${ev.category}]`;
            if (ev.event_time) {
                const [h, m] = ev.event_time.split(':');
                const hour = parseInt(h);
                const ampm = hour >= 12 ? 'PM' : 'AM';
                const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                line += ` at ${h12}:${m} ${ampm}`;
            }
            context += line + '\n';
        }

        return context;
    } catch (err) {
        log.warn('Calendar context fetch failed', { error: err.message });
        return '';
    }
}

/**
 * Simple recurring event expander for calendar context.
 * Mirrors expandRecurringEvent() from contentCalendar.js but standalone.
 */
function expandRecurringForRange(event, rangeStart, rangeEnd) {
    if (!event.recurrence_rule) return [event];

    const instances = [];
    const start = new Date(event.event_date + 'T00:00:00');
    const end = event.recurrence_end_date
        ? new Date(event.recurrence_end_date + 'T00:00:00')
        : new Date(rangeEnd + 'T00:00:00');
    const rangeStartDate = new Date(rangeStart + 'T00:00:00');
    const rangeEndDate = new Date(rangeEnd + 'T00:00:00');

    let current = new Date(start);
    let safety = 0;

    while (current <= end && current <= rangeEndDate && safety < 400) {
        safety++;
        if (current >= rangeStartDate) {
            instances.push({
                ...event,
                event_date: current.toISOString().split('T')[0]
            });
        }
        const next = new Date(current);
        if (event.recurrence_rule === 'daily') next.setDate(next.getDate() + 1);
        else if (event.recurrence_rule === 'weekly') next.setDate(next.getDate() + 7);
        else if (event.recurrence_rule === 'monthly') next.setMonth(next.getMonth() + 1);
        current = next;
    }

    return instances;
}

// ─── Rated examples context builder ──────────────────────────────────

function buildRatedExamplesContext(ratedExamples) {
    if (!ratedExamples) return '';

    let context = '';

    if (ratedExamples.positive && ratedExamples.positive.length > 0) {
        context += '\n\nPREVIOUSLY APPROVED RESPONSES (emulate this style and approach):\n';
        ratedExamples.positive.forEach((ex, i) => {
            context += `\nExample ${i + 1}:\nCustomer inquiry: ${ex.inquiry}\nApproved response: ${ex.response}\n`;
        });
    }

    if (ratedExamples.negative && ratedExamples.negative.length > 0) {
        context += '\n\nPREVIOUSLY REJECTED RESPONSES (avoid these patterns):\n';
        ratedExamples.negative.forEach((ex, i) => {
            context += `\nExample ${i + 1}:\nCustomer inquiry: ${ex.inquiry}\nRejected response: ${ex.response}\n`;
            if (ex.rating_feedback) {
                context += `Reason for rejection: ${ex.rating_feedback}\n`;
            }
            if (ex.corrected_response) {
                context += `Correct response: ${ex.corrected_response}\n`;
            }
        });
    }

    return context;
}

// ─── Fetch rated examples from database ──────────────────────────────

async function fetchRatedExamples(organizationId, tool, format, inquiry) {
    const formatClause = format ? ` AND format = $3` : '';
    const params = format ? [organizationId, tool, format] : [organizationId, tool];

    // Fetch a larger pool when inquiry is provided (Haiku will filter for relevance)
    const positiveLimit = inquiry ? 30 : 8;
    const negativeLimit = inquiry ? 15 : 5;

    const positiveResult = await pool.query(
        `SELECT inquiry, response, format, tone
         FROM response_history
         WHERE organization_id = $1 AND rating = 'positive' AND (tool = $2 OR tool IS NULL)${formatClause}
         ORDER BY rating_at DESC
         LIMIT ${positiveLimit}`,
        params
    );

    const negativeResult = await pool.query(
        `SELECT rh.inquiry, rh.response, rh.rating_feedback, rh.format, rh.tone,
                kb.content AS corrected_response
         FROM response_history rh
         LEFT JOIN knowledge_base kb
            ON rh.feedback_kb_entry_id = kb.id
         WHERE rh.organization_id = $1 AND rh.rating = 'negative' AND (rh.tool = $2 OR rh.tool IS NULL)${formatClause.replace('format', 'rh.format')}
         ORDER BY rh.rating_at DESC
         LIMIT ${negativeLimit}`,
        params
    );

    // If an inquiry was provided, use Haiku to filter for topical relevance
    if (inquiry && (positiveResult.rows.length > 8 || negativeResult.rows.length > 5)) {
        return await pickRelevantRatedExamples(
            inquiry,
            positiveResult.rows,
            negativeResult.rows,
            8,
            5
        );
    }

    return {
        positive: positiveResult.rows,
        negative: negativeResult.rows
    };
}

// ─── Dedicated correction retrieval ─────────────────────────────────
//
// Searches ALL negative-rated responses with corrections (no recency limit)
// and uses Haiku to find ones relevant to the current inquiry.
// This is separate from the rated-examples pool, ensuring corrections
// never fall off a recency cliff.

/**
 * Fetch corrections from past negative feedback that are relevant to the
 * current inquiry. Unlike fetchRatedExamples (which is recency-limited),
 * this searches the ENTIRE correction history for the org.
 *
 * @param {string} organizationId
 * @param {string} inquiry - The current customer inquiry
 * @param {string} tool
 * @param {string} format
 * @returns {Promise<Array>} Relevant corrections with inquiry, feedback, and corrected_response
 */
/**
 * Deduplicate corrections that cover the same topic.
 * Two corrections are considered duplicates if their inquiry text is
 * very similar (>70% word overlap). Keeps the first occurrence (most recent).
 */
function deduplicateCorrections(corrections) {
    if (corrections.length <= 1) return corrections;

    const normalize = (text) => (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);

    const kept = [];
    for (const correction of corrections) {
        const words = new Set(normalize(correction.inquiry));
        const isDuplicate = kept.some(existing => {
            const existingWords = new Set(normalize(existing.inquiry));
            if (words.size === 0 || existingWords.size === 0) return false;
            const intersection = [...words].filter(w => existingWords.has(w)).length;
            const smaller = Math.min(words.size, existingWords.size);
            return smaller > 0 && (intersection / smaller) > 0.7;
        });
        if (!isDuplicate) kept.push(correction);
    }
    return kept;
}

async function fetchRelevantCorrections(organizationId, inquiry, tool, format) {
    if (!inquiry) return [];

    try {
        const formatClause = format ? ` AND rh.format = $3` : '';
        const params = format ? [organizationId, tool, format] : [organizationId, tool];

        // Fetch ALL negative-rated responses that have either:
        // - rating_feedback (user explained what was wrong)
        // - feedback_kb_entry_id (user created a corrected KB entry)
        // No LIMIT — we want to search the entire correction history
        const correctionResult = await pool.query(
            `SELECT rh.inquiry, rh.response, rh.rating_feedback,
                    kb.content AS corrected_response, kb.title AS correction_title
             FROM response_history rh
             LEFT JOIN knowledge_base kb
                ON rh.feedback_kb_entry_id = kb.id
             WHERE rh.organization_id = $1
               AND rh.rating = 'negative'
               AND (rh.tool = $2 OR rh.tool IS NULL)
               AND (rh.rating_feedback IS NOT NULL OR rh.feedback_kb_entry_id IS NOT NULL)
               ${formatClause}
             ORDER BY rh.rating_at DESC`,
            params
        );

        if (correctionResult.rows.length === 0) return [];

        // Use Haiku to find which corrections are relevant to this inquiry.
        // We show Haiku the original inquiry that was corrected so it can
        // do semantic topic matching.
        const corrections = correctionResult.rows;

        // If we have 5 or fewer corrections, deduplicate and return
        if (corrections.length <= 5) return deduplicateCorrections(corrections);

        // Build catalogue for Haiku
        const catalogue = corrections.map((c, i) =>
            `[${i}] Customer asked: "${c.inquiry.substring(0, 200)}"`
        ).join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 200,
                system: `You are a correction matcher. Given a new customer inquiry and a list of past corrected inquiries, return ONLY the index numbers of past inquiries that are on a SIMILAR TOPIC to the new one. Be generous — if the topic is related, include it. Return a JSON array. Example: [0, 2, 4]`,
                messages: [{
                    role: 'user',
                    content: `New customer inquiry: ${inquiry}\n\nPast corrected inquiries:\n${catalogue}`
                }]
            })
        });

        if (!response.ok) {
            // Fallback: return most recent 5 corrections
            return corrections.slice(0, 5);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        const match = text.match(/\[[\d,\s]*\]/);

        if (!match) return corrections.slice(0, 5);

        const indices = JSON.parse(match[0]);
        const relevant = indices
            .filter(i => typeof i === 'number' && i >= 0 && i < corrections.length)
            .map(i => corrections[i]);

        // Deduplicate corrections that cover the same topic.
        // When the same question is corrected multiple times, keep only the
        // most recent correction (which appears first due to ORDER BY rating_at DESC).
        const deduped = deduplicateCorrections(relevant);

        return deduped.length > 0 ? deduped.slice(0, 5) : corrections.slice(0, 3);

    } catch (err) {
        log.warn('Correction retrieval failed', { error: err.message });
        return [];
    }
}

/**
 * Build the CORRECTIONS prompt section from fetched corrections.
 * This is a dedicated section with highest-priority instructions.
 */
function buildCorrectionsContext(corrections) {
    if (!corrections || corrections.length === 0) return '';

    let context = '\n\nCORRECTIONS FROM PAST FEEDBACK (HIGHEST PRIORITY — always follow these when applicable):\n';
    context += 'When similar questions were asked before, staff corrected the response. If a correction below directly addresses the current inquiry, follow the correction over general knowledge base entries.\n';

    corrections.forEach((c, i) => {
        context += `\nCorrection ${i + 1}:\n`;
        context += `Original question: ${c.inquiry.substring(0, 300)}\n`;
        if (c.corrected_response) {
            context += `Correct answer: ${c.corrected_response}\n`;
        }
        if (c.rating_feedback) {
            context += `Staff note: ${c.rating_feedback}\n`;
        }
    });

    return context;
}

// ─── Main system prompt builder ──────────────────────────────────────

/**
 * Build the complete system prompt for the Response Assistant.
 *
 * This replaces the frontend prompt construction that was in app.js:7269-7290.
 * The frontend now sends only parameters; all template logic lives here.
 *
 * @param {object} params
 * @param {string} params.organizationId - Org UUID
 * @param {string} params.inquiry - Customer inquiry text
 * @param {string} params.format - 'email' or 'facebook'
 * @param {number} params.tone - 0-100 slider value
 * @param {number} params.length - 0-100 slider value
 * @param {boolean} params.includeLinks - Whether to include website links
 * @param {boolean} params.includeSteps - Whether to include step-by-step instructions
 * @param {string} params.agentInstructions - Custom staff instructions
 * @param {string} params.staffName - Name to sign as
 * @param {string} params.language - 'en', 'fr', or 'es'
 * @param {string} params.tool - Tool identifier (default: 'response_assistant')
 * @returns {Promise<{ systemPrompt: string, userPrompt: string, maxTokens: number }>}
 */
async function buildResponseAssistantPrompt(params) {
    const {
        organizationId,
        inquiry,
        format = 'email',
        tone = 50,
        length: lengthValue = 50,
        includeLinks = true,
        includeSteps = false,
        agentInstructions = '',
        staffName = 'Support Team',
        language = 'en',
        tool = 'response_assistant',
        isThread = false
    } = params;

    const isFacebook = format === 'facebook';

    // Map slider values to descriptions
    const toneDesc = tone < 33 ? 'formal and professional' :
                     tone > 66 ? 'warm and friendly' : 'balanced';
    const lengthDesc = isFacebook ? 'very brief (MUST be under 400 characters total)' :
                       lengthValue < 33 ? 'brief and concise' :
                       lengthValue > 66 ? 'detailed and thorough' : 'moderate length';

    // Fetch org profile
    const orgResult = await pool.query(
        'SELECT name, website_url, support_email, store_location, licence_number, cta_website_url, mission FROM organizations WHERE id = $1',
        [organizationId]
    );
    const org = orgResult.rows[0] || {};
    const orgName = org.name || 'our organization';
    const orgWebsite = org.website_url || '';
    const orgSupportEmail = org.support_email || '';

    // Fetch calendar events context
    let calendarContext = '';
    try {
        calendarContext = await buildCalendarContext(organizationId);
    } catch (err) {
        log.warn('Calendar context fetch failed', { error: err.message });
    }

    // Fetch rated examples + dedicated corrections (in parallel)
    let ratedExamplesContext = '';
    let correctionsContext = '';
    try {
        const [ratedExamples, corrections] = await Promise.all([
            fetchRatedExamples(organizationId, tool, format, inquiry),
            fetchRelevantCorrections(organizationId, inquiry, tool, format)
        ]);
        ratedExamplesContext = buildRatedExamplesContext(ratedExamples);
        correctionsContext = buildCorrectionsContext(corrections);
    } catch (err) {
        log.warn('Rated examples / corrections fetch failed', { error: err.message });
    }

    // Language instruction
    const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || '';

    // Format instructions
    let formatInstructions = '';
    if (isThread) {
        const linkInfo = orgWebsite ? `You MUST include ${orgWebsite} in the response. Reference it naturally (e.g., "Visit ${orgWebsite} for..." or "You can find more at ${orgWebsite}").` : 'Include relevant website links when helpful.';
        formatInstructions = `LINKS: ${linkInfo}
FORMAT: This is a reply within an ongoing email thread. Use flowing paragraphs. Do NOT repeat information or pleasantries already covered earlier in the thread.`;
    } else if (isFacebook) {
        const fbEmailDirective = orgSupportEmail
            ? `"Please email us at ${orgSupportEmail} and our team will assist you as soon as possible."`
            : '"Please email us and our team will assist you as soon as possible."';
        formatInstructions = `FORMAT: This is a FACEBOOK COMMENT response.
- CRITICAL: Response MUST be under 400 characters total (including signature)
- Write in a single paragraph - NO line breaks, NO bullet points, NO numbered lists
- Be friendly but concise
- End with a dash and the staff name (e.g., "-${staffName}")
- Do NOT include greetings like "Hi" or "Hello" - jump right into the response
- Do NOT include email signatures, contact info, or closing phrases like "Best regards"

FACEBOOK PRIVACY RULE - VERY IMPORTANT:
- NEVER offer to take direct action on Facebook (e.g., "I'll resend your tickets", "I've forwarded this to our team", "Let me look into your account")
- Facebook is a public platform where we cannot verify identity or handle sensitive account matters
- Instead, ALWAYS direct the customer to email us: ${fbEmailDirective}
- You can acknowledge their concern briefly, but the solution must be to email us`;
    } else {
        const linkInfo = orgWebsite ? `You MUST include ${orgWebsite} in the response. Reference it naturally (e.g., "Visit ${orgWebsite} for..." or "You can find more at ${orgWebsite}").` : 'Include relevant website links when helpful.';
        formatInstructions = `${includeLinks ? `LINKS: ${linkInfo}` : 'LINKS: Minimize links unless essential.'}
${includeSteps ? 'FORMAT: Include step-by-step instructions when applicable.' : 'FORMAT: Use flowing paragraphs, avoid numbered lists unless necessary.'}`;
    }

    // Organization info section
    let orgInfoSection = `ORGANIZATION INFO:\n- Organization: ${orgName}`;
    if (orgWebsite) orgInfoSection += `\n- Lottery Website: ${orgWebsite} (ONLY use this URL - do NOT make up other URLs)`;
    if (orgSupportEmail) orgInfoSection += `\n- Support Email: ${orgSupportEmail}`;
    if (org.store_location) orgInfoSection += `\n- In-Person Location: ${org.store_location}`;
    if (org.licence_number) orgInfoSection += `\n- Licence Number: ${org.licence_number}`;
    if (org.cta_website_url) orgInfoSection += `\n- Catch The Ace Website: ${org.cta_website_url}`;

    if (orgWebsite) {
        orgInfoSection += `\n\nIMPORTANT: Only use the URLs listed above. Do NOT invent or guess other URLs - they may not exist.`;
    }
    if (org.mission) {
        orgInfoSection += `\n\nORGANIZATION MISSION: ${org.mission}`;
    }

    // Assemble system prompt
    const threadFraming = isThread
        ? ` You will be given a full email thread between a customer and support staff. Your task is to write a reply to the LATEST message from the customer, taking the full conversation history into account. Do not repeat information or pleasantries already covered in the thread.`
        : '';
    const systemPrompt = `You are a helpful customer support assistant for ${orgName}, a charitable lottery organization.${threadFraming}

TONE: Write in a ${toneDesc} tone.
LENGTH: Keep the response ${lengthDesc}.
${languageInstruction}${formatInstructions}

${orgInfoSection}

${calendarContext}
GENERAL LOTTERY KNOWLEDGE (use only when relevant and not contradicted by the organization's knowledge base):
- Winners are typically contacted directly by phone
- Tax receipts generally cannot be issued for lottery tickets (they are not charitable donations under CRA rules)

CALENDAR AWARENESS: When the customer asks about upcoming dates, draws, events, campaigns, or deadlines, use the UPCOMING CALENDAR EVENTS data to give specific, accurate answers. If no calendar events are available, let the customer know they can check the organization's website for the latest schedule.

ESCALATION: If the inquiry is unclear, bizarre, nonsensical, confrontational, threatening, or simply cannot be answered with the knowledge available, write a polite response explaining that you will pass the email along to your manager who can look into it further. Do not attempt to answer questions you don't have information for.

IMPORTANT: Only reference information from the organization knowledge base below and the calendar events above. Do not assume details about websites, locations, game types, eligibility rules, or operational procedures that are not explicitly provided.

Knowledge base:
${correctionsContext}${ratedExamplesContext}${!correctionsContext.trim() && !ratedExamplesContext.trim() ? '\n(No knowledge base entries are available yet. Only provide general information and recommend the customer contact support directly for specific questions.)\n' : ''}`;

    // Build user prompt with XML-delimited user content for prompt injection defense
    const sanitizedInquiry = sanitizeInquiry(inquiry, isThread ? MAX_THREAD_LENGTH : MAX_INQUIRY_LENGTH);

    const instructionsBlock = agentInstructions
        ? `\n${wrapUserContent('agent_instructions', agentInstructions)}\n`
        : '';

    let userPrompt;
    if (isThread) {
        userPrompt = `The following is a complete email thread. Read the entire conversation for context, then write a reply to the latest customer message.
${instructionsBlock}
${wrapUserContent('email_thread', sanitizedInquiry)}

Sign as: ${staffName}`;
    } else if (isFacebook) {
        const fbEmailRef = orgSupportEmail ? `direct them to email ${orgSupportEmail} for assistance` : 'direct them to email for assistance';
        userPrompt = `Write a FACEBOOK COMMENT reply to the customer inquiry below. Remember: under 400 characters, single paragraph, end with -${staffName}

IMPORTANT: Do NOT offer to take any direct action. Instead, ${fbEmailRef}.
${instructionsBlock}
${wrapUserContent('customer_inquiry', sanitizedInquiry)}`;
    } else {
        userPrompt = `Write a response to the customer inquiry below. Detect which lottery it's about from context.
${instructionsBlock}
${wrapUserContent('customer_inquiry', sanitizedInquiry)}

Sign as: ${staffName}`;
    }

    const maxTokens = isFacebook ? 200 : 1024;

    return { systemPrompt, userPrompt, maxTokens };
}

module.exports = {
    buildResponseAssistantPrompt,
    buildCalendarContext,
    buildRatedExamplesContext,
    buildCorrectionsContext,
    fetchRatedExamples,
    fetchRelevantCorrections,
    sanitizeInquiry,
    wrapUserContent,
    LANGUAGE_INSTRUCTIONS
};
