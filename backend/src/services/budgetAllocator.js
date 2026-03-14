/**
 * Dynamic Budget Allocator
 *
 * Instead of fixed token budgets for each context layer (KB = 30K, memory = fixed, etc.),
 * this service classifies the complexity of an incoming inquiry and allocates
 * the context window budget proportionally.
 *
 * Complexity levels:
 * - simple:  Greetings, store hours, basic FAQs — minimal KB needed
 * - medium:  Standard product/policy questions — moderate KB + some memory
 * - complex: Multi-part troubleshooting, complaints, technical issues — max KB + memory
 */

/**
 * Classify inquiry complexity based on text signals.
 * Uses heuristics rather than an LLM call to keep it fast and free.
 *
 * @param {string} inquiry - The customer inquiry text
 * @returns {'simple' | 'medium' | 'complex'}
 */
function classifyComplexity(inquiry) {
    if (!inquiry) return 'simple';

    const text = inquiry.toLowerCase();
    const wordCount = text.split(/\s+/).length;
    const questionCount = (text.match(/\?/g) || []).length;

    // Simple signals: very short, greetings, basic questions
    const simplePatterns = [
        /^(hi|hello|hey|thanks|thank you|good morning|good afternoon)\b/,
        /^what (are|is) your (hours|address|location|phone|email)/,
        /^(where are you|how do i contact|how to reach)/,
        /^(ok|okay|got it|sounds good|perfect|great)\b/,
    ];

    if (wordCount <= 8 && simplePatterns.some(p => p.test(text))) {
        return 'simple';
    }

    // Complex signals: long messages, multiple questions, complaint language
    const complexPatterns = [
        /\b(not working|doesn't work|broken|issue|problem|error|bug)\b/,
        /\b(refund|cancel|complaint|frustrated|unacceptable|disappointed)\b/,
        /\b(multiple|several|few|many|all of|each of)\b/,
        /\b(however|furthermore|additionally|moreover|also)\b/,
        /\b(step.?by.?step|instructions|how.?to|walk me through)\b/,
    ];

    const complexSignals = complexPatterns.filter(p => p.test(text)).length;

    if (wordCount > 40 || questionCount >= 3 || complexSignals >= 2 || (wordCount > 20 && complexSignals >= 1)) {
        return 'complex';
    }

    if (wordCount > 15 || questionCount >= 2 || complexSignals >= 1) {
        return 'medium';
    }

    // Short single questions default to medium
    if (questionCount >= 1) {
        return 'medium';
    }

    return 'simple';
}

/**
 * Budget allocations per complexity level.
 * Values are in estimated tokens.
 */
const BUDGET_PROFILES = {
    simple: {
        knowledgeBase: 5000,
        conversationMemory: 2000,
        ratedExamples: 3000,
        crossTool: 1000,
        voiceProfile: 500,
        maxKbEntries: 3,
    },
    medium: {
        knowledgeBase: 25000,
        conversationMemory: 5000,
        ratedExamples: 5000,
        crossTool: 2000,
        voiceProfile: 800,
        maxKbEntries: 8,
    },
    complex: {
        knowledgeBase: 50000,
        conversationMemory: 10000,
        ratedExamples: 8000,
        crossTool: 3000,
        voiceProfile: 1000,
        maxKbEntries: 15,
    },
};

/**
 * Get the token budget allocation for an inquiry.
 *
 * @param {string} inquiry - The customer inquiry text
 * @returns {{ complexity: string, budgets: object }}
 */
function getBudgetAllocation(inquiry) {
    const complexity = classifyComplexity(inquiry);
    return {
        complexity,
        budgets: BUDGET_PROFILES[complexity]
    };
}

module.exports = {
    classifyComplexity,
    getBudgetAllocation,
    BUDGET_PROFILES
};
