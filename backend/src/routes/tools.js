/**
 * AI Tools Routes
 * Generate responses, analyze data, normalize lists
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const claudeService = require('../services/claude');

/**
 * POST /api/generate
 * Generate AI response (Response Assistant)
 */
router.post('/generate', authenticate, async (req, res) => {
    try {
        const { messages, system, max_tokens = 1024 } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages array required' });
        }

        // Get user's organization for usage logging
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        const organizationId = orgResult.rows[0]?.organization_id;

        // Call Claude API
        const response = await claudeService.generateResponse({
            messages,
            system,
            max_tokens
        });

        // Log usage
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'response_assistant', $3, NOW())`,
                [organizationId, req.userId, totalTokens]
            );
        }

        res.json(response);

    } catch (error) {
        console.error('Generate error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate response' });
    }
});

/**
 * POST /api/analyze
 * Analyze uploaded data (Insights Engine)
 */
router.post('/analyze', authenticate, async (req, res) => {
    try {
        const { data, reportType, additionalContext } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'Data required for analysis' });
        }

        // Get user's organization
        const orgResult = await pool.query(
            `SELECT o.*, om.organization_id
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1 LIMIT 1`,
            [req.userId]
        );

        const organization = orgResult.rows[0];
        const brandVoice = organization?.brand_voice || '';

        // Build analysis prompt based on report type
        let systemPrompt = `You are a data analyst for a nonprofit organization. Analyze the provided data and generate actionable insights.`;

        if (brandVoice) {
            systemPrompt += ` Use this brand voice: ${brandVoice}`;
        }

        let userPrompt = '';

        switch (reportType) {
            case 'customer_purchases':
                userPrompt = `Analyze this customer purchases data and provide:
1. Key metrics summary (total revenue, average order value, top customers)
2. Trends and patterns
3. Recommendations for improvement

Data:
${JSON.stringify(data, null, 2)}`;
                break;

            case 'sellers':
                userPrompt = `Analyze this sellers performance data and provide:
1. Top performers
2. Areas needing improvement
3. Recommendations for seller support

Data:
${JSON.stringify(data, null, 2)}`;
                break;

            case 'payment_tickets':
                userPrompt = `Analyze this payment tickets data and provide:
1. Payment status overview
2. Outstanding issues
3. Recommendations for follow-up

Data:
${JSON.stringify(data, null, 2)}`;
                break;

            default:
                userPrompt = `Analyze this data and provide insights and recommendations:

Data:
${JSON.stringify(data, null, 2)}`;
        }

        if (additionalContext) {
            userPrompt += `\n\nAdditional context: ${additionalContext}`;
        }

        // Call Claude API
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: systemPrompt,
            max_tokens: 2048
        });

        // Log usage
        if (organization?.organization_id && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'insights_engine', $3, NOW())`,
                [organization.organization_id, req.userId, totalTokens]
            );
        }

        res.json(response);

    } catch (error) {
        console.error('Analyze error:', error);
        res.status(500).json({ error: error.message || 'Failed to analyze data' });
    }
});

/**
 * POST /api/normalize
 * Normalize list data via AI (List Normalizer - general purpose)
 */
router.post('/normalize', authenticate, async (req, res) => {
    try {
        const { data, outputFormat, instructions } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'Data required for normalization' });
        }

        const isTransformMode = outputFormat === 'transform';

        let systemPrompt, userPrompt;

        if (isTransformMode) {
            systemPrompt = `You are a data transformation expert. You receive sample rows from a spreadsheet (as JSON) and user instructions for how to transform the data.

Your job is to return ONLY a JavaScript function body that transforms a single row.

The function receives one argument: \`row\` — an object where keys are column names and values are cell values (strings or numbers).

The function must return:
- A new object with the desired output columns, OR
- null to exclude/remove that row

Rules:
- Return ONLY the raw function body — no \`function\` keyword, no markdown fences, no explanation
- Use plain JavaScript (no imports, no async, no DOM access)
- Column names in the input are EXACTLY as provided in the sample — use those exact keys
- Handle missing/null values gracefully with || '' or similar
- String operations: .trim(), .toLowerCase(), .toUpperCase(), etc.
- For deduplication, return the row as-is — deduplication will be handled separately by the caller

Example — if user says "combine First Name and Last Name into Full Name, keep Email, remove rows without email":
const firstName = (row['First Name'] || '').toString().trim();
const lastName = (row['Last Name'] || '').toString().trim();
const email = (row['Email'] || '').toString().trim();
if (!email) return null;
return { 'Full Name': (firstName + ' ' + lastName).trim(), 'Email': email.toLowerCase() };`;

            userPrompt = `Here are sample rows from the spreadsheet:
${data}

CRITICAL: The EXACT column names you must use to access row data are shown in the JSON keys above. Copy them exactly — they are case-sensitive and may contain spaces or special characters.

User instructions: ${instructions}

Return ONLY the JavaScript function body. No explanation, no markdown, no \`\`\` fences.`;
        } else if (outputFormat === 'json') {
            systemPrompt = `You are a data transformation expert. You receive spreadsheet data as a JSON array of objects and user instructions describing how to transform it. Apply the transformations and return ONLY a valid JSON array of objects — no markdown fences, no explanation, no extra text. Just the raw JSON array starting with [ and ending with ].`;
            userPrompt = `Here is the data:\n${data}\n\n${instructions || 'Clean and normalize this data.'}`;
        } else {
            systemPrompt = `You are a data formatting expert. Clean and normalize the provided data according to the specified format. Return ONLY the normalized data, no explanations or additional text.`;
            userPrompt = `Normalize and clean this data`;
            if (outputFormat) userPrompt += ` into ${outputFormat} format`;
            userPrompt += `:\n\n${data}`;
            if (instructions) userPrompt += `\n\nAdditional instructions: ${instructions}`;
        }

        // Call Claude API
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: systemPrompt,
            max_tokens: isTransformMode ? 2048 : 8192
        });

        // Get organization for logging
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        const organizationId = orgResult.rows[0]?.organization_id;

        // Log usage
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'list_normalizer', $3, NOW())`,
                [organizationId, req.userId, totalTokens]
            );
        }

        res.json(response);

    } catch (error) {
        console.error('Normalize error:', error);
        res.status(500).json({ error: error.message || 'Failed to normalize data' });
    }
});

/**
 * POST /api/normalize/log
 * Log client-side list normalizer usage (no AI tokens, just record counts)
 */
router.post('/normalize/log', authenticate, async (req, res) => {
    try {
        const { originalCount, cleanCount, removedCount, fileName } = req.body;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        const organizationId = orgResult.rows[0]?.organization_id;

        if (organizationId) {
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'list_normalizer', $3, NOW())`,
                [organizationId, req.userId, cleanCount || 0]
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Normalize log error:', error);
        res.status(500).json({ error: 'Failed to log usage' });
    }
});

/**
 * POST /api/draft
 * Generate draft content (Draft Assistant)
 */
router.post('/draft', authenticate, async (req, res) => {
    try {
        const { prompt, draftType, tone, length, additionalContext } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt required' });
        }

        // Get user's organization for brand voice
        const orgResult = await pool.query(
            `SELECT o.brand_voice
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1 LIMIT 1`,
            [req.userId]
        );

        const brandVoice = orgResult.rows[0]?.brand_voice || '';

        let systemPrompt = `You are a professional content writer for a nonprofit organization.`;

        if (brandVoice) {
            systemPrompt += ` Use this brand voice: ${brandVoice}`;
        }

        if (tone) {
            systemPrompt += ` Write in a ${tone} tone.`;
        }

        if (length) {
            systemPrompt += ` Keep the content ${length}.`;
        }

        let userPrompt = prompt;

        if (draftType) {
            userPrompt = `Write a ${draftType}: ${prompt}`;
        }

        if (additionalContext) {
            userPrompt += `\n\nAdditional context: ${additionalContext}`;
        }

        // Call Claude API
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: systemPrompt,
            max_tokens: 2048
        });

        // Get organization for logging
        const orgResult2 = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        const organizationId = orgResult2.rows[0]?.organization_id;

        // Log usage
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'draft_assistant', $3, NOW())`,
                [organizationId, req.userId, totalTokens]
            );
        }

        res.json(response);

    } catch (error) {
        console.error('Draft error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate draft' });
    }
});

module.exports = router;
