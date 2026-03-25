/**
 * Voice Fingerprint Service
 *
 * Analyzes an organization's approved responses to extract a custom
 * voice/tone profile — vocabulary, sentence patterns, sign-off style,
 * formality level, etc. Supports per-tool profiles so Draft Assistant
 * learns writing style separately from Response Assistant's reply style.
 */

const pool = require('../../config/database');
const { cache } = require('./cache');
const log = require('./logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const HAIKU_MODEL = process.env.HAIKU_MODEL || 'claude-haiku-4-5-20251001';

const VOICE_CACHE_TTL = 60 * 60 * 1000;

/**
 * Get the organization's voice profile for a specific tool (from cache, then DB).
 * Falls back to the general profile if no tool-specific one exists.
 */
async function getVoiceProfile(organizationId, tool = 'general') {
    const cacheKey = `voice:${organizationId}:${tool}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
        // Try tool-specific first, then fall back to general
        const result = await pool.query(
            `SELECT profile_text, tool FROM voice_profiles
             WHERE organization_id = $1 AND tool IN ($2, 'general')
             ORDER BY CASE WHEN tool = $2 THEN 0 ELSE 1 END
             LIMIT 1`,
            [organizationId, tool]
        );

        if (result.rows.length > 0) {
            const profileText = result.rows[0].profile_text;
            cache.set(cacheKey, profileText, VOICE_CACHE_TTL);
            return profileText;
        }

        return null;
    } catch (err) {
        log.warn('Voice profile retrieval failed', { error: err.message });
        return null;
    }
}

/**
 * Build the voice profile context block for prompt injection.
 * Returns empty string if no profile exists.
 */
async function getVoiceProfileContext(organizationId, tool = 'general') {
    const profile = await getVoiceProfile(organizationId, tool);
    if (!profile) return '';

    const label = tool === 'draft_assistant'
        ? 'WRITING VOICE PROFILE (this organization\'s content writing style — match this voice):'
        : 'VOICE PROFILE (this organization\'s communication style — match this voice in all outputs):';

    return `\n\n${label}\n${profile}`;
}

const TOOL_ANALYSIS_PROMPTS = {
    draft_assistant: `Analyze the following approved WRITTEN CONTENT (emails, social posts, press releases, ads) from a charitable lottery organization and extract a concise writing style profile.

Focus on:
- Sentence length and paragraph structure preferences
- Vocabulary level and recurring phrases
- How they open and close different content types
- Emoji and punctuation usage patterns
- Level of formality vs. warmth in written content
- How they handle calls-to-action
- Headline and subject line style

Return ONLY the writing style profile as a concise guide (under 300 words) that another AI could follow to match this organization's content writing voice. Format as bullet points. No preamble.`,

    general: `Analyze the following approved responses from a charitable lottery organization and extract a concise voice and style profile.

Focus on:
- Vocabulary preferences and recurring phrases
- Sentence structure and length patterns
- Level of formality and warmth
- Sign-off styles and greeting patterns
- How they handle technical/compliance topics vs casual inquiries
- Any distinctive brand voice characteristics

Return ONLY the voice profile as a concise guide (under 300 words) that another AI could follow to match this organization's voice. Format it as bullet points. Do not include any preamble or explanation.`
};

/**
 * Analyze approved responses and build/rebuild the voice profile.
 * Supports per-tool profiles for specialized voice matching.
 */
async function buildVoiceProfile(organizationId, tool = 'general') {
    try {
        const toolFilter = tool === 'general'
            ? '' : ` AND tool = '${tool === 'draft_assistant' ? 'draft_assistant' : 'response_assistant'}'`;

        const result = await pool.query(
            `SELECT inquiry, response, format, tone
             FROM response_history
             WHERE organization_id = $1
               AND rating = 'positive'${toolFilter}
             ORDER BY created_at DESC
             LIMIT 30`,
            [organizationId]
        );

        if (result.rows.length < 5) {
            return null;
        }

        const sampleResponses = result.rows.slice(0, 20).map((r, i) =>
            `Example ${i + 1} (${r.format || 'general'}, ${r.tone || 'default'}):\n${r.response}`
        ).join('\n\n---\n\n');

        const basePrompt = TOOL_ANALYSIS_PROMPTS[tool] || TOOL_ANALYSIS_PROMPTS.general;
        const analysisPrompt = `${basePrompt}\n\nAPPROVED ${tool === 'draft_assistant' ? 'CONTENT' : 'RESPONSES'}:\n${sampleResponses}`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: HAIKU_MODEL,
                max_tokens: 600,
                messages: [{ role: 'user', content: analysisPrompt }]
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            log.warn('Voice profile analysis API error', { status: response.status, error: errData });
            return null;
        }

        const data = await response.json();
        const profileText = data.content?.[0]?.text;
        if (!profileText) return null;

        // Upsert the profile with tool specificity
        await pool.query(
            `INSERT INTO voice_profiles (id, organization_id, tool, profile_text, source_count, last_analyzed_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
             ON CONFLICT (organization_id, tool)
             DO UPDATE SET profile_text = $3, source_count = $4, last_analyzed_at = NOW(), updated_at = NOW()`,
            [organizationId, tool, profileText, result.rows.length]
        );

        cache.set(`voice:${organizationId}:${tool}`, profileText, VOICE_CACHE_TTL);

        return profileText;
    } catch (err) {
        log.warn('Voice profile generation failed', { error: err.message });
        return null;
    }
}

module.exports = {
    getVoiceProfile,
    getVoiceProfileContext,
    buildVoiceProfile
};
