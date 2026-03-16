/**
 * Compliance Prompt Builder
 * Builds the system prompt for the Compliance Assistant AI agent.
 * This prompt is hardcoded server-side and never modifiable from the frontend.
 */

const MANDATORY_REMINDER = `We recommend you reach out to an agent or representative of your regulatory body for official guidance. Lightspeed is designed to provide general regulatory information and guidance only — it is not a substitute for professional legal advice, and like all AI tools, it can make mistakes. Always verify critical compliance decisions directly with your provincial regulator.`;

/**
 * Build the system prompt for the Compliance Assistant
 * @param {Object} options
 * @param {string} options.jurisdictionName - Full jurisdiction name (e.g., "Ontario")
 * @param {string} options.regulatoryBody - Regulatory body name
 * @param {string} options.regulatoryUrl - Regulatory body URL
 * @param {Array} options.knowledgeEntries - Relevant KB entries to inject
 * @returns {string} The complete system prompt
 */
function buildComplianceSystemPrompt({ jurisdictionName, regulatoryBody, regulatoryUrl, knowledgeEntries }) {
    const kbContent = knowledgeEntries.map((entry, i) => {
        let block = `--- ENTRY [ID: ${entry.id}] ---\n`;
        block += `Title: ${entry.title}\n`;
        block += `Category: ${entry.category}\n`;
        if (entry.source_name) block += `Source: ${entry.source_name}\n`;
        if (entry.source_section) block += `Section: ${entry.source_section}\n`;
        if (entry.source_url) block += `URL: ${entry.source_url}\n`;
        if (entry.last_verified_date) block += `Last Verified: ${entry.last_verified_date}\n`;
        // Use original_text (exact regulatory text) as the authoritative source
        if (entry.original_text) {
            block += `\n${entry.original_text}\n`;
        } else {
            block += `\n${entry.content}\n`;
        }
        return block;
    }).join('\n');

    return `You are the Lightspeed Compliance Assistant, a specialized AI tool that helps charitable lottery and raffle operators understand regulatory requirements in their jurisdiction.

CRITICAL RULES:
1. You ONLY answer questions based on the knowledge base content provided to you. If the answer is not in the provided knowledge base content, say: "I don't have specific guidance on that topic for ${jurisdictionName} in my current knowledge base. We recommend reaching out directly to ${regulatoryBody} for guidance on this."
2. You NEVER make up, guess, or infer regulatory information. If you're not certain, say so.
3. You NEVER provide legal advice. You provide regulatory guidance, analysis, and information only.
4. You ALWAYS cite which knowledge base entry/entries your answer is based on. Use the format [Citation: entry_id] inline so the system can link to sources. Use the actual UUID entry ID from the ENTRY headers below.
5. You provide thorough, accurate analysis of the regulatory content. Present the information as it is written in the regulations — do not simplify, water down, or paraphrase the regulatory language. Operators need to understand exactly what the regulations say. You may provide context and explain how provisions relate to the user's question, but always preserve the accuracy and specificity of the original regulatory text.
6. You ALWAYS stay scoped to the user's selected jurisdiction (${jurisdictionName}). Never reference rules from other provinces unless the user explicitly asks for a comparison.
7. If a question is outside the scope of lottery/raffle/gaming compliance, politely redirect: "I'm specifically designed to help with lottery and raffle regulatory compliance. For other questions, I'd recommend reaching out to the appropriate resource."

JURISDICTION CONTEXT:
The user is operating in: ${jurisdictionName}
Regulatory body: ${regulatoryBody}
Regulatory website: ${regulatoryUrl}

KNOWLEDGE BASE CONTENT:
${kbContent || 'No knowledge base entries are available for this jurisdiction yet.'}

RESPONSE FORMAT:
- Use clear, well-structured responses with headings and bullet points where appropriate
- Always include inline [Citation: entry_id] markers referencing the specific knowledge base entries you're drawing from
- Provide thorough analysis — quote and reference the exact regulatory text where relevant
- When multiple provisions apply, present them all so the operator has the complete picture

MANDATORY CLOSING (include this EXACT text at the end of EVERY response, no exceptions):
${MANDATORY_REMINDER}`;
}

/**
 * Build the per-response disclaimer with jurisdiction-specific details
 * @param {string} regulatoryBody - Regulatory body name
 * @param {string} regulatoryUrl - Regulatory body URL
 * @param {string} latestVerifiedDate - Most recent verified date among cited sources
 * @returns {string} The disclaimer text
 */
function buildDisclaimer(regulatoryBody, regulatoryUrl, latestVerifiedDate) {
    return `⚠️ Disclaimer: This guidance is based on ${regulatoryBody} regulations as of ${latestVerifiedDate || 'the most recent verification'}. Regulations can change — we recommend reaching out to a representative of ${regulatoryBody} (${regulatoryUrl}) to verify current requirements. Lightspeed provides regulatory guidance only and is not a substitute for professional legal advice. AI can make mistakes.`;
}

/**
 * Build the stale content warning if any cited entries are older than 90 days
 * @param {Array} citedEntries - Knowledge base entries that were cited
 * @param {string} regulatoryBody - Regulatory body name
 * @returns {string|null} Warning text or null if all entries are fresh
 */
function buildStaleWarning(citedEntries, regulatoryBody) {
    if (!citedEntries || citedEntries.length === 0) return null;

    const now = new Date();
    const staleEntries = citedEntries.filter(entry => {
        if (!entry.last_verified_date) return true;
        const verified = new Date(entry.last_verified_date);
        const daysSince = Math.floor((now - verified) / (1000 * 60 * 60 * 24));
        return daysSince > 90;
    });

    if (staleEntries.length === 0) return null;

    const oldestEntry = staleEntries.reduce((oldest, entry) => {
        const d = new Date(entry.last_verified_date || '2020-01-01');
        return d < new Date(oldest.last_verified_date || '2020-01-01') ? entry : oldest;
    });
    const daysSince = Math.floor((now - new Date(oldestEntry.last_verified_date || '2020-01-01')) / (1000 * 60 * 60 * 24));

    return `⚠️ Note: Some of the regulatory information referenced in this response was last verified over ${daysSince} days ago. Regulations may have changed since then. We strongly recommend verifying current requirements with ${regulatoryBody} before acting on this guidance.`;
}

/**
 * Build the welcome message for a new conversation
 * @param {string} jurisdictionName - Full jurisdiction name
 * @param {string} regulatoryBody - Regulatory body name
 * @param {string} regulatoryUrl - Regulatory body URL
 * @param {string} latestVerifiedDate - Most recent verified date in the KB
 * @returns {string} Welcome message
 */
function buildWelcomeMessage(jurisdictionName, regulatoryBody, regulatoryUrl, latestVerifiedDate) {
    return `Welcome to the Lightspeed Compliance Assistant. I can help you understand regulatory requirements for charitable lotteries and raffles in ${jurisdictionName}, based on ${regulatoryBody} guidelines.

You can ask me about licensing requirements, reporting obligations, draw rules, prize limits, advertising regulations, online sales rules, and more.

A few important things to know:

• My knowledge base was last verified on ${latestVerifiedDate || 'N/A'}. Regulations can change at any time.
• I provide guidance based on regulatory documents — not legal advice.
• For official rulings or interpretations, always contact ${regulatoryBody} directly at ${regulatoryUrl}.
• I can make mistakes. Always verify critical compliance decisions with your regulatory body or a legal professional.

What can I help you with?`;
}

/**
 * Parse citation markers from AI response text
 * Extracts [Citation: entry_id] patterns and returns array of entry IDs
 * @param {string} text - The AI response text
 * @returns {Array<string>} Array of unique entry IDs
 */
function parseCitations(text) {
    const regex = /\[Citation:\s*([a-f0-9-]+)\]/gi;
    const ids = new Set();
    let match;
    while ((match = regex.exec(text)) !== null) {
        ids.add(match[1]);
    }
    return Array.from(ids);
}

module.exports = {
    buildComplianceSystemPrompt,
    buildDisclaimer,
    buildStaleWarning,
    buildWelcomeMessage,
    parseCitations,
    MANDATORY_REMINDER
};
