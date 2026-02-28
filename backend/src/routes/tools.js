/**
 * AI Tools Routes
 * Generate responses, analyze data, normalize lists
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate, checkUsageLimit } = require('../middleware/auth');
const claudeService = require('../services/claude');
const shopifyService = require('../services/shopify');

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

        // Get user's organization for usage logging
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        const organizationId = orgResult.rows[0]?.organization_id;

        let enhancedSystem = system || '';
        let referencedKbEntries = [];

        // Server-side KB relevance picking when inquiry is provided
        if (inquiry && organizationId) {
            try {
                // Determine which KB types to query based on the calling tool
                // 'all' = Ask Lightspeed (both KBs), 'support' = Response Assistant, 'internal' = Draft Assistant
                let kbFilter = "AND kb_type = 'support'";
                if (kb_type === 'all') {
                    kbFilter = ''; // query both
                } else if (kb_type === 'internal') {
                    kbFilter = "AND kb_type = 'internal'";
                }

                const kbResult = await pool.query(
                    `SELECT id, title, content, category, tags FROM knowledge_base WHERE organization_id = $1 ${kbFilter} ORDER BY category, title`,
                    [organizationId]
                );

                if (kbResult.rows.length > 0) {
                    // Use Haiku to pick relevant entries
                    const relevantEntries = await claudeService.pickRelevantKnowledge(
                        inquiry,
                        kbResult.rows,
                        8
                    );

                    if (relevantEntries.length > 0) {
                        // Store the referenced entries to return to the frontend
                        referencedKbEntries = relevantEntries.map((entry, idx) => ({
                            id: entry.id,
                            title: entry.title,
                            content: entry.content,
                            category: entry.category,
                            citation_index: idx + 1
                        }));

                        // Number KB entries for citation support
                        const knowledgeContext = relevantEntries
                            .map((entry, idx) => `[Source ${idx + 1}] [${entry.category}] ${entry.title}: ${entry.content}`)
                            .join('\n\n');

                        const citationInstruction = '\n\nCITATION RULES: When your response uses information from the knowledge base sources above, include inline citations using the format [1], [2], etc. corresponding to the source numbers. Only cite when you directly use information from a specific source. Do not cite for general knowledge.';

                        // Insert KB entries after the "Knowledge base:" marker in the system prompt.
                        // The marker is placed by the frontend; rated examples may follow it.
                        if (enhancedSystem.includes('Knowledge base:')) {
                            enhancedSystem = enhancedSystem.replace(
                                'Knowledge base:\n',
                                `Knowledge base:\n\n${knowledgeContext}\n${citationInstruction}\n`
                            );
                        } else {
                            enhancedSystem += `\n\nRelevant knowledge base information:\n${knowledgeContext}${citationInstruction}`;
                        }
                    }
                }
            } catch (kbError) {
                console.warn('KB relevance picking failed, continuing without:', kbError.message);
            }
        }

        // Inject Shopify context if the org has a connected store
        if (inquiry && organizationId) {
            try {
                const shopifyContext = await shopifyService.buildContextForInquiry(organizationId, inquiry);
                if (shopifyContext) {
                    enhancedSystem += shopifyContext;
                }
            } catch (shopifyErr) {
                console.warn('Shopify context injection failed, continuing without:', shopifyErr.message);
            }
        }

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
        console.error('Generate error:', error);
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
        const { messages, system, inquiry, max_tokens = 1024, model, kb_type } = req.body;

        // Whitelist allowed models to prevent abuse
        const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
        const selectedModel = model && ALLOWED_MODELS.includes(model) ? model : undefined;

        if (!messages || !Array.isArray(messages)) {
            sendEvent({ type: 'error', error: 'Messages array required' });
            return res.end();
        }

        // Get user's organization for usage logging
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        const organizationId = orgResult.rows[0]?.organization_id;

        let enhancedSystem = system || '';
        let referencedKbEntries = [];

        // Server-side KB relevance picking when inquiry is provided
        if (inquiry && organizationId) {
            try {
                // Determine which KB types to query based on the calling tool
                let kbFilter = "AND kb_type = 'support'";
                if (kb_type === 'all') {
                    kbFilter = '';
                } else if (kb_type === 'internal') {
                    kbFilter = "AND kb_type = 'internal'";
                }

                const kbResult = await pool.query(
                    `SELECT id, title, content, category, tags FROM knowledge_base WHERE organization_id = $1 ${kbFilter} ORDER BY category, title`,
                    [organizationId]
                );

                if (kbResult.rows.length > 0) {
                    const relevantEntries = await claudeService.pickRelevantKnowledge(
                        inquiry,
                        kbResult.rows,
                        8
                    );

                    if (relevantEntries.length > 0) {
                        referencedKbEntries = relevantEntries.map((entry, idx) => ({
                            id: entry.id,
                            title: entry.title,
                            content: entry.content,
                            category: entry.category,
                            citation_index: idx + 1
                        }));

                        const knowledgeContext = relevantEntries
                            .map((entry) => `[${entry.category}] ${entry.title}: ${entry.content}`)
                            .join('\n\n');

                        if (enhancedSystem.includes('Knowledge base:')) {
                            enhancedSystem = enhancedSystem.replace(
                                'Knowledge base:\n',
                                `Knowledge base:\n\n${knowledgeContext}\n`
                            );
                        } else {
                            enhancedSystem += `\n\nRelevant knowledge base information:\n${knowledgeContext}`;
                        }
                    }
                }
            } catch (kbError) {
                console.warn('KB relevance picking failed, continuing without:', kbError.message);
            }
        }

        // Inject Shopify context if the org has a connected store
        if (inquiry && organizationId) {
            try {
                const shopifyContext = await shopifyService.buildContextForInquiry(organizationId, inquiry);
                if (shopifyContext) {
                    enhancedSystem += shopifyContext;
                }
            } catch (shopifyErr) {
                console.warn('Shopify context injection failed, continuing without:', shopifyErr.message);
            }
        }

        // Send KB entries before streaming starts
        if (referencedKbEntries.length > 0) {
            sendEvent({ type: 'kb', entries: referencedKbEntries });
        }

        // Stream the Claude response
        const startTime = Date.now();

        const { text, usage } = await claudeService.streamResponse({
            messages,
            system: enhancedSystem,
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
                 VALUES (gen_random_uuid(), $1, $2, 'response_assistant', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs]
            ).catch(err => console.warn('Usage logging failed:', err.message));
        }

        sendEvent({ type: 'done', usage: usage || {} });
        res.end();

    } catch (error) {
        console.error('Generate-stream error:', error);
        sendEvent({ type: 'error', error: error.message || 'Failed to generate response' });
        res.end();
    }
});

/**
 * POST /api/analyze
 * Analyze uploaded data (Insights Engine)
 */
router.post('/analyze', authenticate, checkUsageLimit, async (req, res) => {
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

        // Call Claude API
        const startTime = Date.now();
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: systemPrompt,
            max_tokens: 2048
        });
        const responseTimeMs = Date.now() - startTime;

        // Log usage
        if (organization?.organization_id && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'insights_engine', $3, $4, TRUE, NOW())`,
                [organization.organization_id, req.userId, totalTokens, responseTimeMs]
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
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'list_normalizer', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs]
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
router.post('/draft', authenticate, checkUsageLimit, async (req, res) => {
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

        // Server-side KB injection for Draft Assistant — uses internal KB
        const orgResult3 = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const draftOrgId = orgResult3.rows[0]?.organization_id;
        if (draftOrgId) {
            try {
                const kbResult = await pool.query(
                    `SELECT id, title, content, category, tags FROM knowledge_base
                     WHERE organization_id = $1 AND kb_type = 'internal'
                     ORDER BY category, title`,
                    [draftOrgId]
                );
                if (kbResult.rows.length > 0) {
                    const relevantEntries = await claudeService.pickRelevantKnowledge(
                        prompt,
                        kbResult.rows,
                        8
                    );
                    if (relevantEntries.length > 0) {
                        const kbContext = relevantEntries
                            .map(entry => `[${entry.category}] ${entry.title}: ${entry.content}`)
                            .join('\n\n');
                        systemPrompt += `\n\nInternal knowledge base:\n${kbContext}`;
                    }
                }
            } catch (kbErr) {
                console.warn('Draft KB injection failed, continuing without:', kbErr.message);
            }

            // Inject Shopify product context for product-related drafts
            try {
                const productContext = await shopifyService.buildProductContext(draftOrgId, { limit: 15 });
                if (productContext) {
                    systemPrompt += productContext;
                    systemPrompt += '\n\nYou have access to the product catalog above. When writing about products, use accurate names, prices, and details from this catalog.';
                }
            } catch (shopifyErr) {
                // Continue without Shopify context
            }
        }

        // Call Claude API
        const startTime2 = Date.now();
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: systemPrompt,
            max_tokens: 2048
        });
        const responseTimeMs2 = Date.now() - startTime2;

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
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'draft_assistant', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs2]
            );
        }

        res.json(response);

    } catch (error) {
        console.error('Draft error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate draft' });
    }
});

/**
 * GET /api/tools/shopify-analytics
 * Pull Shopify analytics data for the Insights Engine (instead of Excel upload).
 */
router.get('/shopify-analytics', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;

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
        console.error('Shopify analytics fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch Shopify analytics' });
    }
});

module.exports = router;
