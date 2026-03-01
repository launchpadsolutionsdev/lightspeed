/**
 * Output Validator Service
 *
 * Checks AI-generated responses for potential issues:
 * - System prompt leakage
 * - PII patterns (credit cards, SSNs)
 * - Suspicious content that might indicate prompt injection success
 *
 * Returns warnings alongside the response — does not block generation.
 */

// Fragments from the system prompt that should never appear in output
const PROMPT_LEAKAGE_PATTERNS = [
    'ORGANIZATION RESPONSE RULES (you MUST follow these)',
    'CITATION RULES: When your response uses information',
    'PREVIOUSLY APPROVED RESPONSES (emulate this style',
    'PREVIOUSLY REJECTED RESPONSES (avoid these patterns',
    'FACEBOOK PRIVACY RULE - VERY IMPORTANT',
    'DRAW DATE AWARENESS: If the customer asks',
    'ESCALATION: If the inquiry is unclear, bizarre',
    'You are a helpful customer support assistant for',
    'GENERAL LOTTERY KNOWLEDGE (use only when relevant',
];

// PII regex patterns
const PII_PATTERNS = [
    { name: 'credit_card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
    { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: 'sin', pattern: /\b\d{3}\s?\d{3}\s?\d{3}\b/g }, // Canadian SIN
];

/**
 * Validate a generated response for potential issues.
 *
 * @param {string} responseText - The AI-generated response
 * @param {object} options
 * @param {string[]} options.orgEmails - Known org email addresses (not flagged as PII)
 * @returns {{ warnings: Array<{ type: string, message: string }> }}
 */
function validateOutput(responseText, options = {}) {
    const warnings = [];
    const { orgEmails = [] } = options;

    if (!responseText) return { warnings };

    // Check for system prompt leakage
    for (const fragment of PROMPT_LEAKAGE_PATTERNS) {
        if (responseText.includes(fragment)) {
            warnings.push({
                type: 'prompt_leakage',
                message: `Response may contain system prompt content`
            });
            break; // One warning is enough
        }
    }

    // Check for PII patterns
    for (const { name, pattern } of PII_PATTERNS) {
        const matches = responseText.match(pattern);
        if (matches) {
            warnings.push({
                type: 'pii_detected',
                message: `Possible ${name.replace('_', ' ')} detected in response`
            });
        }
    }

    // Check for email addresses that aren't the org's known emails
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    const emails = responseText.match(emailPattern) || [];
    const orgEmailSet = new Set(orgEmails.map(e => e.toLowerCase()));
    const unknownEmails = emails.filter(e => !orgEmailSet.has(e.toLowerCase()));
    if (unknownEmails.length > 0) {
        warnings.push({
            type: 'unknown_email',
            message: `Response contains email address(es) not in org profile: ${unknownEmails.join(', ')}`
        });
    }

    return { warnings };
}

/**
 * Validate format-specific compliance (Facebook char limit, email structure, etc.).
 * Returns an array of violation objects that get merged into the main warnings.
 *
 * @param {string} responseText - The AI-generated response
 * @param {string} format - 'email' or 'facebook'
 * @param {object} options
 * @param {boolean} options.hasKbEntries - Whether KB entries were provided to the model
 * @returns {Array<{ type: string, message: string }>}
 */
function validateFormatCompliance(responseText, format, options = {}) {
    const violations = [];
    if (!responseText || !format) return violations;

    const charCount = responseText.length;
    const wordCount = responseText.trim().split(/\s+/).length;
    const lowerText = responseText.toLowerCase();

    if (format === 'facebook') {
        if (charCount > 400) {
            violations.push({
                type: 'format_violation',
                message: `Facebook response is ${charCount} chars — exceeds 400-character limit`
            });
        }
        if (responseText.includes('\n')) {
            violations.push({
                type: 'format_violation',
                message: 'Facebook response contains line breaks — should be single paragraph'
            });
        }
        if (/[•\-]\s/.test(responseText) || /^\d+\.\s/m.test(responseText)) {
            violations.push({
                type: 'format_violation',
                message: 'Facebook response contains bullet points or numbered lists'
            });
        }
    } else if (format === 'email') {
        if (wordCount < 20) {
            violations.push({
                type: 'format_warning',
                message: 'Email response may be too brief (under 20 words)'
            });
        } else if (wordCount > 300) {
            violations.push({
                type: 'format_warning',
                message: 'Email response may be too long (over 300 words)'
            });
        }
        if (!lowerText.match(/^(hi|hello|dear|good\s(morning|afternoon|evening))/)) {
            violations.push({
                type: 'format_warning',
                message: 'Email response may be missing a greeting'
            });
        }
    }

    // Citation consistency: response references [1] etc. but no KB entries were provided
    const citationRefs = responseText.match(/\[\d+\]/g);
    if (citationRefs && citationRefs.length > 0 && !options.hasKbEntries) {
        violations.push({
            type: 'citation_mismatch',
            message: 'Response contains citation references but no KB entries were matched'
        });
    }

    return violations;
}

module.exports = { validateOutput, validateFormatCompliance };
