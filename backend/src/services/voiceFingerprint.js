/**
 * Voice Fingerprint Service
 *
 * Analyzes an organization's approved responses to extract a custom
 * voice/tone profile — vocabulary, sentence patterns, sign-off style,
 * formality level, etc. The profile is stored per-org and injected into
 * all tool prompts so outputs automatically match the org's voice.
 */

const pool = require('../../config/database');
const { cache, TTL } = require('./cache');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Cache voice profiles for 1 hour in memory
const VOICE_CACHE_TTL = 60 * 60 * 1000;

/**
 * Get the organization's voice profile (from cache, then DB).
 * Returns null if no profile has been generated yet.
 *
 * @param {string} organizationId
 * @returns {Promise<string|null>} Profile text or null
 */
async function getVoiceProfile(organizationId) {
    const cacheKey = `voice:${organizationId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
        const result = await pool.query(
            `SELECT profile_text FROM voice_profiles WHERE organization_id = $1`,
            [organizationId]
        );

        if (result.rows.length > 0) {
            const profileText = result.rows[0].profile_text;
            cache.set(cacheKey, profileText, VOICE_CACHE_TTL);
            return profileText;
        }

        return null;
    } catch (err) {
        console.warn('Voice profile retrieval failed:', err.message);
        return null;
    }
}

/**
 * Build the voice profile context block for prompt injection.
 * Returns empty string if no profile exists.
 *
 * @param {string} organizationId
 * @returns {Promise<string>} Context block or empty string
 */
async function getVoiceProfileContext(organizationId) {
    const profile = await getVoiceProfile(organizationId);
    if (!profile) return '';

    return `\n\nVOICE PROFILE (this organization's communication style — match this voice in all outputs):\n${profile}`;
}

/**
 * Analyze approved responses and build/rebuild the voice profile.
 * Requires at least 5 positively-rated responses to produce a reliable profile.
 * Uses Haiku for cost-efficient analysis.
 *
 * @param {string} organizationId
 * @returns {Promise<string|null>} Generated profile text, or null if insufficient data
 */
async function buildVoiceProfile(organizationId) {
    try {
        // Get positively-rated responses for this org (across all tools)
        const result = await pool.query(
            `SELECT inquiry, response, format, tone
             FROM response_history
             WHERE organization_id = $1
               AND rating = 'positive'
             ORDER BY created_at DESC
             LIMIT 30`,
            [organizationId]
        );

        if (result.rows.length < 5) {
            return null; // Not enough data to build a reliable profile
        }

        const sampleResponses = result.rows.slice(0, 20).map((r, i) =>
            `Example ${i + 1} (${r.format || 'general'}, ${r.tone || 'default'}):\n${r.response}`
        ).join('\n\n---\n\n');

        const analysisPrompt = `Analyze the following approved responses from a charitable lottery organization and extract a concise voice and style profile.

Focus on:
- Vocabulary preferences and recurring phrases
- Sentence structure and length patterns
- Level of formality and warmth
- Sign-off styles and greeting patterns
- How they handle technical/compliance topics vs casual inquiries
- Any distinctive brand voice characteristics

Return ONLY the voice profile as a concise guide (under 300 words) that another AI could follow to match this organization's voice. Format it as bullet points. Do not include any preamble or explanation.

APPROVED RESPONSES:
${sampleResponses}`;

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
            console.warn('Voice profile analysis API error:', response.status, errData);
            return null;
        }

        const data = await response.json();
        const profileText = data.content?.[0]?.text;
        if (!profileText) return null;

        // Upsert the profile
        await pool.query(
            `INSERT INTO voice_profiles (id, organization_id, profile_text, source_count, last_analyzed_at)
             VALUES (gen_random_uuid(), $1, $2, $3, NOW())
             ON CONFLICT (organization_id)
             DO UPDATE SET profile_text = $2, source_count = $3, last_analyzed_at = NOW(), updated_at = NOW()`,
            [organizationId, profileText, result.rows.length]
        );

        // Update cache
        cache.set(`voice:${organizationId}`, profileText, VOICE_CACHE_TTL);

        return profileText;
    } catch (err) {
        console.warn('Voice profile generation failed:', err.message);
        return null;
    }
}

module.exports = {
    getVoiceProfile,
    getVoiceProfileContext,
    buildVoiceProfile
};
