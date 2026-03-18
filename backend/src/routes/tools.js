/**
 * AI Tools Routes
 * Generate responses, analyze data, normalize lists
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate, checkUsageLimit, checkAIRateLimit } = require('../middleware/auth');
const claudeService = require('../services/claude');
const shopifyService = require('../services/shopify');
const { buildEnhancedPrompt } = require('../services/promptBuilder');
const { buildResponseAssistantPrompt, buildCalendarContext } = require('../services/systemPromptBuilder');
const { validateOutput, validateFormatCompliance } = require('../services/outputValidator');
const log = require('../services/logger');

/**
 * POST /api/response-assistant/generate
 * Unified Response Assistant endpoint — prompt is built entirely server-side.
 *
 * The frontend sends only parameters (tone, format, language, etc.) and the
 * backend assembles the complete system prompt, fetches rated examples, picks
 * relevant KB entries, injects Shopify context, and streams the response.
 *
 * This replaces the pattern where the frontend built the system prompt and
 * sent it wholesale via /api/generate-stream.
 */
router.post('/response-assistant/generate', authenticate, checkAIRateLimit, checkUsageLimit, async (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const {
            inquiry, format, tone, length, includeLinks, includeSteps,
            agentInstructions, staffName, language, tool, isThread
        } = req.body;

        if (!inquiry) {
            sendEvent({ type: 'error', error: 'Inquiry text is required' });
            return res.end();
        }

        const organizationId = req.organizationId;

        // 1. Build system + user prompts entirely server-side
        const { systemPrompt, userPrompt, maxTokens } = await buildResponseAssistantPrompt({
            organizationId,
            inquiry,
            format,
            tone,
            length,
            includeLinks,
            includeSteps,
            agentInstructions,
            staffName,
            language,
            tool,
            isThread: !!isThread
        });

        // 2. Enhance with KB entries, response rules, and Shopify context
        // Response Assistant should not include citation markers — those are only for Ask Lightspeed
        const { system: enhancedSystem, referencedKbEntries, contextSummary } = await buildEnhancedPrompt(
            systemPrompt, inquiry, organizationId, { kb_type: 'support', userId: req.userId, includeCitations: false, tool: 'response_assistant' }
        );

        // Send KB entries before streaming starts
        if (referencedKbEntries.length > 0) {
            sendEvent({ type: 'kb', entries: referencedKbEntries });
        }

        // 3. Stream the response (track partial text for error recovery)
        const startTime = Date.now();
        let partialText = '';

        const { text, usage } = await claudeService.streamResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: enhancedSystem,
            max_tokens: maxTokens,
            onText: (chunk) => {
                partialText += chunk;
                sendEvent({ type: 'delta', text: chunk });
            }
        });

        const responseTimeMs = Date.now() - startTime;

        // Log usage
        if (organizationId && usage) {
            const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'response_assistant', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs]
            ).catch(err => log.warn('Usage logging failed', { error: err.message }));
        }

        // Validate output for safety + format compliance
        const { warnings } = validateOutput(text, { orgEmails: [] });
        const formatViolations = validateFormatCompliance(text, req.body.format, {
            hasKbEntries: referencedKbEntries.length > 0,
            isThread: !!isThread
        });
        warnings.push(...formatViolations);
        if (warnings.length > 0) {
            log.warn('[OUTPUT VALIDATION]', { warnings });
        }

        sendEvent({
            type: 'done',
            usage: usage || {},
            warnings,
            contextSummary,
            quality: {
                charCount: text.length,
                wordCount: text.trim().split(/\s+/).length,
                kbEntriesUsed: referencedKbEntries.length,
                responseTimeMs
            }
        });
        res.end();

    } catch (error) {
        log.error('Response assistant generate error', { error: error.message || error });
        sendEvent({
            type: 'error',
            error: error.message || 'Failed to generate response',
            partial: true,
            retry: true
        });
        res.end();
    }
});

/**
 * POST /api/generate
 * Generate AI response (Response Assistant)
 *
 * When `inquiry` is provided in the body, the server will:
 *   1. Fetch all KB entries for the organization
 *   2. Use Haiku to pick the most relevant entries for the inquiry
 *   3. Inject those entries into the system prompt
 *
 * This replaces the old approach of the frontend dumping 30 random entries.
 */
router.post('/generate', authenticate, checkUsageLimit, async (req, res) => {
    try {
        const { messages, system, inquiry, max_tokens = 1024, kb_type } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages array required' });
        }

        const organizationId = req.organizationId;

        // Build enhanced system prompt with rules, KB, and Shopify context
        const { system: enhancedSystem, referencedKbEntries } = await buildEnhancedPrompt(
            system, inquiry, organizationId, { kb_type, userId: req.userId }
        );

        // Call Claude API
        const startTime = Date.now();
        const response = await claudeService.generateResponse({
            messages,
            system: enhancedSystem,
            max_tokens
        });
        const responseTimeMs = Date.now() - startTime;

        // Log usage
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'response_assistant', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs]
            );
        }

        // Include referenced KB entries in the response so the frontend
        // can show them in the feedback modal for inline editing
        if (referencedKbEntries.length > 0) {
            response.referenced_kb_entries = referencedKbEntries;
        }

        res.json(response);

    } catch (error) {
        log.error('Generate error', { error: error.message || error });
        res.status(500).json({ error: error.message || 'Failed to generate response' });
    }
});

/**
 * POST /api/generate-stream
 * Stream AI response via Server-Sent Events.
 * Same KB-picking logic as /generate, but returns chunks via SSE.
 *
 * SSE event format:
 *   data: {"type":"delta","text":"chunk"}        — text chunk
 *   data: {"type":"kb","entries":[...]}           — referenced KB entries (sent first)
 *   data: {"type":"done","usage":{...}}           — stream complete
 *   data: {"type":"error","error":"message"}      — error
 */
router.post('/generate-stream', authenticate, checkUsageLimit, async (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const { messages, system, staticSystem, dynamicSystem, inquiry, max_tokens = 1024, model, kb_type, includeCitations, tool } = req.body;

        // Whitelist allowed models to prevent abuse
        const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
        const selectedModel = model && ALLOWED_MODELS.includes(model) ? model : undefined;

        if (!messages || !Array.isArray(messages)) {
            sendEvent({ type: 'error', error: 'Messages array required' });
            return res.end();
        }

        const organizationId = req.organizationId;

        let finalStaticSystem, finalDynamicSystem, referencedKbEntries;

        let contextSummary = {};

        if (staticSystem !== undefined && dynamicSystem !== undefined) {
            // Split-prompt path (Ask Lightspeed, Draft Assistant): Layer 1 is static and cached; Layer 2+3 is dynamic.
            // Run buildEnhancedPrompt only on the dynamic portion so Layer 1 is never modified.
            const enhanced = await buildEnhancedPrompt(dynamicSystem, inquiry, organizationId, {
                kb_type, userId: req.userId, includeCitations: !!includeCitations, tool
            });
            finalStaticSystem = staticSystem;
            finalDynamicSystem = enhanced.system;
            referencedKbEntries = enhanced.referencedKbEntries;
            contextSummary = enhanced.contextSummary || {};
        } else {
            // Legacy path: single system string — enhance the whole thing as before
            const enhanced = await buildEnhancedPrompt(system, inquiry, organizationId, {
                kb_type, userId: req.userId, includeCitations: !!includeCitations, tool
            });
            finalStaticSystem = null;
            finalDynamicSystem = enhanced.system;
            referencedKbEntries = enhanced.referencedKbEntries;
            contextSummary = enhanced.contextSummary || {};
        }

        // Send KB entries before streaming starts
        if (referencedKbEntries.length > 0) {
            sendEvent({ type: 'kb', entries: referencedKbEntries });
        }

        // Stream the Claude response
        const startTime = Date.now();

        const { text, usage } = await claudeService.streamResponse({
            messages,
            staticSystem: finalStaticSystem,
            dynamicSystem: finalDynamicSystem,
            max_tokens,
            model: selectedModel,
            onText: (chunk) => {
                sendEvent({ type: 'delta', text: chunk });
            }
        });

        const responseTimeMs = Date.now() - startTime;

        // Log usage
        if (organizationId && usage) {
            const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, TRUE, NOW())`,
                [organizationId, req.userId, tool || 'response_assistant', totalTokens, responseTimeMs]
            ).catch(_e => log.warn('Usage logging failed', { error: _e.message }));
        }

        sendEvent({ type: 'done', usage: usage || {}, contextSummary });
        res.end();

    } catch (error) {
        log.error('Generate-stream error', { error: error.message || error });
        sendEvent({ type: 'error', error: error.message || 'Failed to generate response' });
        res.end();
    }
});

/**
 * POST /api/voice-profile/generate
 * Build or rebuild the org's voice fingerprint from approved responses.
 * Requires at least 5 positively-rated responses.
 */
router.post('/voice-profile/generate', authenticate, async (req, res) => {
    try {
        const { buildVoiceProfile } = require('../services/voiceFingerprint');
        const profile = await buildVoiceProfile(req.organizationId);

        if (!profile) {
            return res.status(400).json({
                error: 'Not enough approved responses to generate a voice profile. Rate at least 5 responses positively first.'
            });
        }

        res.json({ success: true, profile });
    } catch (error) {
        log.error('Voice profile generation error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to generate voice profile' });
    }
});

/**
 * GET /api/voice-profile
 * Retrieve the org's current voice profile.
 */
router.get('/voice-profile', authenticate, async (req, res) => {
    try {
        const { getVoiceProfile } = require('../services/voiceFingerprint');
        const profile = await getVoiceProfile(req.organizationId);
        res.json({ profile });
    } catch (error) {
        log.error('Voice profile retrieval error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to retrieve voice profile' });
    }
});

/**
 * POST /api/analyze
 * Analyze uploaded data (Insights Engine)
 *
 * Now context-aware: injects light KB, calendar events, cross-tool context,
 * voice fingerprint, and corrections via the unified context pipeline.
 */
router.post('/analyze', authenticate, checkUsageLimit, async (req, res) => {
    try {
        const { data, reportType, additionalContext } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'Data required for analysis' });
        }

        const organizationId = req.organizationId;

        // Fetch org details
        let organization = null;
        if (organizationId) {
            const orgResult = await pool.query('SELECT name, brand_voice FROM organizations WHERE id = $1', [organizationId]);
            organization = orgResult.rows[0] || null;
        }
        const orgName = organization?.name || 'your organization';

        // Build analysis prompt based on report type
        let systemPrompt = `You are a data analyst for ${orgName}, a charitable lottery / nonprofit organization. Analyze the provided data and generate actionable insights.

When referencing organization-specific terminology, programs, events, or campaigns, use the context provided below for accuracy. If upcoming calendar events are relevant to the data trends, reference them.`;

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

            case 'shopify':
                userPrompt = `Analyze this Shopify store data and provide:
1. Revenue overview and key metrics (total revenue, average order value, order count)
2. Top-selling products by revenue and quantity
3. Customer acquisition and retention insights
4. Fulfillment performance (fulfilled vs unfulfilled orders)
5. Sales trends and patterns (daily breakdown if available)
6. Refund rate analysis
7. Actionable recommendations to improve store performance

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

        // Enhance with context pipeline (light KB, calendar, cross-tool, voice, corrections)
        const { system: enhancedSystem, contextSummary } = await buildEnhancedPrompt(
            systemPrompt, additionalContext || reportType || 'data analysis', organizationId, {
                kb_type: 'all',
                userId: req.userId,
                tool: 'insights_engine',
                includeCitations: false,
                _injectCalendar: true
            }
        );

        // Call Claude API
        const startTime = Date.now();
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: enhancedSystem,
            max_tokens: 2048
        });
        const responseTimeMs = Date.now() - startTime;

        // Log usage
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'insights_engine', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs]
            );
        }

        // Save to response_history for cross-tool context
        if (organizationId) {
            pool.query(
                `INSERT INTO response_history (id, organization_id, user_id, tool, inquiry, response, content_type, context_layers_used, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'insights_engine', $3, $4, $5, $6, NOW())`,
                [
                    organizationId, req.userId,
                    (additionalContext || reportType || 'data analysis').substring(0, 500),
                    (response.content?.[0]?.text || '').substring(0, 2000),
                    reportType || 'data_analysis',
                    JSON.stringify(contextSummary)
                ]
            ).catch(_e => log.warn('Insights history save failed', { error: _e.message }));
        }

        // Include context summary in response
        response.contextSummary = contextSummary;
        res.json(response);

    } catch (error) {
        log.error('Analyze error', { error: error.message || error });
        res.status(500).json({ error: error.message || 'Failed to analyze data' });
    }
});

/**
 * POST /api/normalize
 * Normalize list data via AI (List Normalizer - general purpose)
 */
router.post('/normalize', authenticate, checkUsageLimit, async (req, res) => {
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
        const startTime = Date.now();
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: systemPrompt,
            max_tokens: isTransformMode ? 2048 : 8192
        });
        const responseTimeMs = Date.now() - startTime;

        // Log usage
        const organizationId = req.organizationId;
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'list_normalizer', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs]
            );
        }

        res.json(response);

    } catch (error) {
        log.error('Normalize error', { error: error.message || error });
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

        const organizationId = req.organizationId;

        if (organizationId) {
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'list_normalizer', $3, NOW())`,
                [organizationId, req.userId, cleanCount || 0]
            );
        }

        res.json({ success: true });
    } catch (error) {
        log.error('Normalize log error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to log usage' });
    }
});

/**
 * GET /api/tools/shopify-analytics
 * Pull Shopify analytics data for the Insights Engine (instead of Excel upload).
 */
router.get('/shopify-analytics', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;

        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const store = await shopifyService.getStoreConnection(organizationId);
        if (!store) {
            return res.status(404).json({ error: 'No Shopify store connected' });
        }

        const { days = 30 } = req.query;
        const analytics = await shopifyService.getOrderAnalytics(organizationId, { days: parseInt(days) });
        const productCount = await shopifyService.getProductCount(organizationId);
        const customerCount = await shopifyService.getCustomerCount(organizationId);

        res.json({
            analytics,
            counts: {
                products: productCount,
                customers: customerCount
            },
            shopDomain: store.shop_domain,
            lastSync: {
                products: store.last_products_sync_at,
                orders: store.last_orders_sync_at
            }
        });

    } catch (error) {
        log.error('Shopify analytics fetch error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch Shopify analytics' });
    }
});

/**
 * GET /api/calendar-context
 * Returns formatted upcoming calendar events as a text block for AI prompt injection.
 * Used by frontend tools (Ask Lightspeed, Draft Assistant) that build prompts client-side.
 */
router.get('/calendar-context', authenticate, async (req, res) => {
    try {
        const context = await buildCalendarContext(req.organizationId);
        res.json({ context });
    } catch (error) {
        log.error('Calendar context error', { error: error.message || error });
        res.json({ context: '' });
    }
});

module.exports = router;
