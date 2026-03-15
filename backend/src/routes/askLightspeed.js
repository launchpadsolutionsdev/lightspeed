/**
 * Agentic Ask Lightspeed Routes
 *
 * Provides tool-use capabilities for Ask Lightspeed:
 * - File upload + parsing (PDF, Excel, CSV)
 * - Runway calendar event creation/search
 * - Knowledge Base search
 *
 * Uses Anthropic's tool_use feature with a confirmation loop for write actions.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../../config/database');
const { authenticate, checkUsageLimit } = require('../middleware/auth');
const claudeService = require('../services/claude');
const { buildEnhancedPrompt } = require('../services/promptBuilder');
const { buildResponseAssistantPrompt } = require('../services/systemPromptBuilder');

// Multer config: in-memory storage, 10MB limit
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel', // .xls
            'text/csv',
            'application/csv',
        ];
        const ext = (file.originalname || '').split('.').pop().toLowerCase();
        if (allowed.includes(file.mimetype) || ['pdf', 'xlsx', 'xls', 'csv'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type. Use PDF, Excel (.xlsx/.xls), or CSV.'));
        }
    }
});

// ─── Tool Definitions ────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'create_runway_events',
        description: 'Create one or more events on the Runway content calendar. Use this when the user asks you to add events, draws, deadlines, or scheduled items to the calendar. Call this tool directly with the events — the system will show the user a confirmation dialog before anything is created. Do NOT ask for confirmation in text first; just call the tool.',
        input_schema: {
            type: 'object',
            properties: {
                events: {
                    type: 'array',
                    description: 'Array of events to create on Runway',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: 'Event title (e.g., "Draw #47 — $250,000 Jackpot")' },
                            description: { type: 'string', description: 'Optional event description with additional details' },
                            event_date: { type: 'string', description: 'Date in YYYY-MM-DD format (e.g., "2025-06-15")' },
                            event_time: { type: 'string', description: 'Optional time in HH:MM format (e.g., "20:00")' },
                            all_day: { type: 'boolean', description: 'Whether this is an all-day event. Use true for draws that don\'t have a specific time listed' },
                            category: { type: 'string', description: 'Event category — use "Draw" for draw events, or "Deadline", "Meeting", "Email Campaign", "Social Post", "Ad Launch", "Other"' },
                            color: { type: 'string', description: 'Event color: tomato, blue, green, cyan, purple, gray, orange, pink. Default blue for draws.' }
                        },
                        required: ['title', 'event_date']
                    }
                }
            },
            required: ['events']
        }
    },
    {
        name: 'search_runway_events',
        description: 'Search for existing events on the Runway content calendar. Use this to check what\'s already scheduled before creating new events, or to answer questions about upcoming draws and deadlines.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term to find events by title or description' },
                start_date: { type: 'string', description: 'YYYY-MM-DD — return events on or after this date' },
                end_date: { type: 'string', description: 'YYYY-MM-DD — return events on or before this date' },
                category: { type: 'string', description: 'Filter by category (e.g., "Draw")' }
            }
        }
    },
    {
        name: 'search_knowledge_base',
        description: 'Search the Lightspeed Knowledge Base for information about lottery operations, policies, procedures, and FAQs. Use this to answer questions about how things work, what the rules are, or to find specific information.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query to find relevant knowledge base articles' }
            },
            required: ['query']
        }
    },
    {
        name: 'draft_content',
        description: 'Draft professional content using the full Lightspeed content pipeline with brand voice, knowledge base, and org context. Use this when the user asks you to draft an email, social media post, customer response, or any written content that should match their organization\'s tone and style.',
        input_schema: {
            type: 'object',
            properties: {
                inquiry: { type: 'string', description: 'The content request or customer inquiry to respond to. For response drafts, include the original message to respond to.' },
                format: { type: 'string', enum: ['email', 'facebook'], description: 'Content format. Use "email" for emails, letters, and general content. Use "facebook" for social media posts (enforces <400 char limit).' },
                tone: { type: 'number', description: 'Tone slider 0-100. 0=formal, 50=balanced, 100=warm/friendly. Default 50.' },
                length: { type: 'number', description: 'Length slider 0-100. 0=brief, 50=moderate, 100=detailed. Default 50.' },
                staffName: { type: 'string', description: 'Name to sign off with (e.g., "Sarah" or "Support Team"). Default "Support Team".' },
                agentInstructions: { type: 'string', description: 'Optional special instructions for how to draft the content (e.g., "mention the upcoming draw", "keep it under 3 paragraphs")' }
            },
            required: ['inquiry']
        }
    },
    {
        name: 'save_to_knowledge_base',
        description: 'Save information to the organization\'s Knowledge Base. Use this when the user says "remember that...", "our policy is...", "save this to the KB", or explicitly asks to store information for future reference. Call this tool directly — the system will show the user a confirmation dialog before saving. Do NOT ask for confirmation in text first; just call the tool.',
        input_schema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'A clear, descriptive title for the KB entry (e.g., "Office Hours Policy", "Refund Procedure for Online Orders")' },
                content: { type: 'string', description: 'The full content to save. Be thorough and well-structured.' },
                category: { type: 'string', description: 'Category for the entry. Common categories: "faqs", "policies", "procedures", "general", "product-info"' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for better searchability (e.g., ["refunds", "online-orders"])' }
            },
            required: ['title', 'content', 'category']
        }
    },
    {
        name: 'search_response_history',
        description: 'Search past AI-generated responses across all Lightspeed tools (Response Assistant, Draft Assistant, Insights Engine, etc.). Use this when the user asks about previous work, wants to find something they wrote earlier, or needs to reference past content.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term to find in past inquiries and responses' },
                tool: { type: 'string', enum: ['response_assistant', 'draft_assistant', 'ask_lightspeed', 'insights_engine', 'content_generator'], description: 'Optional: filter by specific tool' },
                limit: { type: 'number', description: 'Max results to return (default 10, max 20)' }
            },
            required: ['query']
        }
    },
    {
        name: 'run_insights_analysis',
        description: 'Run an Insights Engine analysis on provided data. Use this when the user asks for analysis of sales data, customer data, seller performance, or any structured data they\'ve shared in the conversation. The data should already be available from an uploaded file or conversation context.',
        input_schema: {
            type: 'object',
            properties: {
                data: { type: 'object', description: 'The data to analyze — can be an object or array of records' },
                reportType: { type: 'string', enum: ['customer_purchases', 'sellers', 'payment_tickets', 'shopify', 'general'], description: 'Type of analysis to run. Use "general" if unsure.' },
                additionalContext: { type: 'string', description: 'Optional extra context or specific questions about the data' }
            },
            required: ['data']
        }
    }
];

// ─── File Parsing ────────────────────────────────────────────────────

async function parseUploadedFile(file) {
    const ext = (file.originalname || '').split('.').pop().toLowerCase();

    if (ext === 'csv') {
        return { type: 'csv', content: file.buffer.toString('utf-8'), filename: file.originalname };
    }

    if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = require('xlsx');
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheets = {};
        for (const name of workbook.SheetNames) {
            sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' });
        }
        // Format as readable text for Claude
        let content = '';
        for (const [sheetName, rows] of Object.entries(sheets)) {
            content += `--- Sheet: ${sheetName} ---\n`;
            if (rows.length > 0) {
                content += `Columns: ${Object.keys(rows[0]).join(', ')}\n\n`;
                rows.forEach((row, i) => {
                    content += `Row ${i + 1}: ${JSON.stringify(row)}\n`;
                });
            }
            content += '\n';
        }
        return { type: 'spreadsheet', content, filename: file.originalname, rowCount: Object.values(sheets).reduce((sum, s) => sum + s.length, 0) };
    }

    if (ext === 'pdf') {
        try {
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(file.buffer);
            return { type: 'pdf', content: data.text, filename: file.originalname, pages: data.numpages };
        } catch (err) {
            console.warn('PDF parse failed, using basic extraction:', err.message);
            return { type: 'pdf', content: file.buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' '), filename: file.originalname };
        }
    }

    return { type: 'unknown', content: file.buffer.toString('utf-8'), filename: file.originalname };
}

// ─── Tool Executors ──────────────────────────────────────────────────

async function executeSearchRunwayEvents(input, organizationId) {
    const conditions = ['organization_id = $1'];
    const params = [organizationId];
    let paramIdx = 2;

    if (input.start_date) {
        conditions.push(`event_date >= $${paramIdx}`);
        params.push(input.start_date);
        paramIdx++;
    }
    if (input.end_date) {
        conditions.push(`event_date <= $${paramIdx}`);
        params.push(input.end_date);
        paramIdx++;
    }
    if (input.query) {
        conditions.push(`(title ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`);
        params.push(`%${input.query}%`);
        paramIdx++;
    }
    if (input.category) {
        conditions.push(`category ILIKE $${paramIdx}`);
        params.push(`%${input.category}%`);
        paramIdx++;
    }

    const result = await pool.query(
        `SELECT id, title, description, event_date, event_time, all_day, category, color
         FROM calendar_events
         WHERE ${conditions.join(' AND ')}
         ORDER BY event_date ASC, event_time ASC NULLS LAST
         LIMIT 50`,
        params
    );

    return result.rows.map(r => ({
        ...r,
        event_date: r.event_date instanceof Date ? r.event_date.toISOString().split('T')[0] : r.event_date
    }));
}

async function executeSearchKnowledgeBase(input, organizationId) {
    const query = input.query;
    if (!query) return [];

    // Use FTS search matching the existing KB pattern
    try {
        const result = await pool.query(
            `SELECT id, title, content, category, tags, updated_at,
                    ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
             FROM knowledge_base
             WHERE organization_id = $1
               AND search_vector @@ plainto_tsquery('english', $2)
             ORDER BY rank DESC
             LIMIT 10`,
            [organizationId, query]
        );

        if (result.rows.length > 0) {
            return result.rows.map(r => ({
                title: r.title,
                category: r.category,
                content: r.content.substring(0, 500),
                updated_at: r.updated_at
            }));
        }

        // Fallback: ILIKE search
        const fallback = await pool.query(
            `SELECT id, title, content, category, updated_at
             FROM knowledge_base
             WHERE organization_id = $1
               AND (title ILIKE $2 OR content ILIKE $2)
             ORDER BY updated_at DESC
             LIMIT 10`,
            [organizationId, `%${query}%`]
        );
        return fallback.rows.map(r => ({
            title: r.title,
            category: r.category,
            content: r.content.substring(0, 500),
            updated_at: r.updated_at
        }));
    } catch (_e) {
        return [];
    }
}

async function executeCreateRunwayEvents(events, organizationId, userId) {
    const VALID_COLORS = ['tomato', 'blue', 'green', 'cyan', 'purple', 'gray', 'orange', 'pink'];
    const created = [];
    const errors = [];

    for (const event of events) {
        try {
            const color = VALID_COLORS.includes(event.color) ? event.color : 'blue';
            const allDay = event.all_day !== false; // Default to all-day if not specified
            const eventTime = allDay ? null : (event.event_time || null);

            const result = await pool.query(
                `INSERT INTO calendar_events (id, organization_id, title, description, event_date, event_time, all_day, color, visibility, category, created_by, created_at, updated_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'team', $8, $9, NOW(), NOW())
                 RETURNING id, title, event_date, event_time, all_day, category, color`,
                [organizationId, event.title, event.description || null, event.event_date, eventTime, allDay, color, event.category || 'Draw', userId]
            );
            created.push(result.rows[0]);
        } catch (err) {
            errors.push({ title: event.title, date: event.event_date, error: err.message });
        }
    }

    return { created, errors };
}

async function executeDraftContent(input, organizationId) {
    try {
        // Build prompt using the full Response Assistant pipeline
        const { systemPrompt, userPrompt, maxTokens } = await buildResponseAssistantPrompt({
            organizationId,
            inquiry: input.inquiry,
            format: input.format || 'email',
            tone: input.tone ?? 50,
            length: input.length ?? 50,
            includeLinks: true,
            includeSteps: false,
            agentInstructions: input.agentInstructions || '',
            staffName: input.staffName || 'Support Team',
            language: 'en',
            tool: 'ask_lightspeed'
        });

        // Enhance with KB, rules, voice
        const { system: enhancedSystem } = await buildEnhancedPrompt(
            systemPrompt, input.inquiry, organizationId,
            { kb_type: 'all', tool: 'response_assistant', includeCitations: false }
        );

        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userPrompt }],
            system: enhancedSystem,
            max_tokens: maxTokens || 1024
        });

        const draft = response.content?.find(b => b.type === 'text')?.text || '';
        return { draft, format: input.format || 'email' };
    } catch (err) {
        return { draft: '', error: err.message };
    }
}

async function executeSaveToKnowledgeBase(input, organizationId, userId) {
    try {
        // Extract keywords from title for tags
        const autoTags = ['source:ask_lightspeed'];
        if (input.tags && Array.isArray(input.tags)) {
            autoTags.push(...input.tags);
        }

        const result = await pool.query(
            `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, kb_type, created_by, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'support', $6, NOW(), NOW())
             RETURNING id, title, category`,
            [organizationId, input.title, input.content, input.category || 'general', autoTags, userId]
        );

        // Invalidate KB cache
        try {
            const kbCache = require('../services/kbCache');
            if (kbCache && kbCache.invalidate) kbCache.invalidate(organizationId);
        } catch (_e) { /* cache service may not exist */ }

        return { saved: true, entry: result.rows[0] };
    } catch (err) {
        return { saved: false, error: err.message };
    }
}

async function executeSearchResponseHistory(input, organizationId) {
    const query = input.query;
    if (!query) return [];

    const limit = Math.min(input.limit || 10, 20);
    const conditions = ['rh.organization_id = $1', '(rh.inquiry ILIKE $2 OR rh.response ILIKE $2)'];
    const params = [organizationId, `%${query}%`];
    let paramIdx = 3;

    if (input.tool) {
        conditions.push(`rh.tool = $${paramIdx}`);
        params.push(input.tool);
        paramIdx++;
    }

    try {
        const result = await pool.query(
            `SELECT rh.id, rh.inquiry, rh.response, rh.tool, rh.format, rh.tone,
                    rh.rating, rh.created_at, u.name AS user_name
             FROM response_history rh
             LEFT JOIN users u ON rh.user_id = u.id
             WHERE ${conditions.join(' AND ')}
             ORDER BY rh.created_at DESC
             LIMIT $${paramIdx}`,
            [...params, limit]
        );

        return result.rows.map(r => ({
            tool: r.tool,
            inquiry: (r.inquiry || '').substring(0, 300),
            response: (r.response || '').substring(0, 400),
            format: r.format,
            rating: r.rating,
            user: r.user_name,
            date: r.created_at
        }));
    } catch (_e) {
        return [];
    }
}

async function executeRunInsightsAnalysis(input, organizationId, userId) {
    const reportType = input.reportType || 'general';
    const data = input.data;

    // Build insights-specific system prompt
    const REPORT_PROMPTS = {
        customer_purchases: 'Analyze this customer purchase data. Identify revenue trends, top customers, purchase patterns, and actionable recommendations.',
        sellers: 'Analyze this seller performance data. Identify top performers, areas for improvement, and support recommendations.',
        payment_tickets: 'Analyze this payment/ticket data. Summarize status overview, identify issues, and suggest follow-ups.',
        shopify: 'Analyze this Shopify store data. Cover revenue, top products, customer acquisition, fulfillment, and recommendations.',
        general: 'Analyze this data thoroughly. Identify key trends, patterns, anomalies, and provide actionable insights.'
    };

    const systemPrompt = `You are the Lightspeed Insights Engine, an expert data analyst. ${REPORT_PROMPTS[reportType] || REPORT_PROMPTS.general}

Present your analysis in a clear, structured format with:
- Key metrics and highlights
- Trends and patterns
- Actionable recommendations
Use markdown formatting for readability.`;

    const additionalCtx = input.additionalContext ? `\n\nAdditional context: ${input.additionalContext}` : '';

    // Enhance with light KB + calendar context
    const { system: enhancedSystem } = await buildEnhancedPrompt(
        systemPrompt, 'data analysis', organizationId,
        { kb_type: 'all', userId, tool: 'insights_engine' }
    );

    try {
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: `Please analyze this data:\n\n${JSON.stringify(data, null, 2)}${additionalCtx}` }],
            system: enhancedSystem,
            max_tokens: 2048
        });

        const analysis = response.content?.find(b => b.type === 'text')?.text || '';

        // Save to response history for cross-tool context
        pool.query(
            `INSERT INTO response_history (id, organization_id, user_id, inquiry, response, format, tone, tool, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, 'analysis', 'professional', 'insights_engine', NOW())`,
            [organizationId, userId, `[Insights Analysis] ${reportType}`, analysis]
        ).catch(_e => {});

        return { analysis };
    } catch (err) {
        return { analysis: '', error: err.message };
    }
}

// ─── Duplicate Detection ─────────────────────────────────────────────

async function findDuplicateEvents(events, organizationId) {
    if (events.length === 0) return [];

    const dates = events.map(e => e.event_date);
    const result = await pool.query(
        `SELECT id, title, event_date, category
         FROM calendar_events
         WHERE organization_id = $1
           AND event_date = ANY($2::date[])
         ORDER BY event_date`,
        [organizationId, dates]
    );

    return result.rows.map(r => ({
        ...r,
        event_date: r.event_date instanceof Date ? r.event_date.toISOString().split('T')[0] : r.event_date
    }));
}

// ─── Main Agentic Endpoint ───────────────────────────────────────────

/**
 * POST /api/ask-lightspeed/agent
 *
 * Agentic Ask Lightspeed endpoint with tool use support.
 * Accepts optional file upload alongside the chat message.
 *
 * Returns SSE events:
 *   {type: 'status', message: '...'}           — tool activity indicator
 *   {type: 'text', content: '...'}             — AI text response
 *   {type: 'confirm', action: '...', data: {}} — confirmation prompt for write actions
 *   {type: 'done', usage: {}}                  — stream complete
 *   {type: 'error', error: '...'}              — error
 */
router.post('/agent', authenticate, checkUsageLimit, upload.single('file'), async (req, res) => {
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
        const { message, conversation, system: clientSystem, model } = req.body;
        const file = req.file;
        const organizationId = req.organizationId;
        const userId = req.userId;

        if (!message && !file) {
            sendEvent({ type: 'error', error: 'Message or file required' });
            return res.end();
        }

        // Parse conversation from form data (comes as string)
        let conversationHistory = [];
        if (conversation) {
            try {
                conversationHistory = JSON.parse(conversation);
            } catch (_e) {
                conversationHistory = [];
            }
        }

        // Parse uploaded file if present
        let fileContext = '';
        if (file) {
            sendEvent({ type: 'status', message: `Parsing ${file.originalname}...` });
            try {
                const parsed = await parseUploadedFile(file);
                fileContext = `\n\n--- Uploaded File: ${parsed.filename} (${parsed.type}) ---\n${parsed.content}\n--- End of file ---`;
                if (parsed.rowCount) {
                    fileContext = `\n\n--- Uploaded File: ${parsed.filename} (${parsed.type}, ${parsed.rowCount} rows) ---\n${parsed.content}\n--- End of file ---`;
                }
            } catch (err) {
                sendEvent({ type: 'status', message: 'File parsing failed, continuing without file data' });
                console.warn('File parse error:', err.message);
            }
        }

        // Build the user message with file content
        const userMessage = fileContext
            ? (message || 'Please analyze the uploaded file.') + fileContext
            : message;

        // Build system prompt
        const systemPrompt = clientSystem || buildAgenticSystemPrompt(currentUser(req));

        // Build messages array
        const messages = [
            ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        // Enhance with KB, rules, etc.
        const { system: enhancedSystem } = await buildEnhancedPrompt(
            systemPrompt, message || '', organizationId,
            { kb_type: 'all', userId, tool: 'ask_lightspeed', includeCitations: true }
        );

        // Whitelist models
        const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
        const selectedModel = model && ALLOWED_MODELS.includes(model) ? model : undefined;

        // Call Claude with tools
        sendEvent({ type: 'status', message: 'Thinking...' });

        const response = await claudeService.generateResponse({
            messages,
            system: enhancedSystem,
            max_tokens: 4096,
            tools: TOOLS,
            model: selectedModel
        });

        // Process the response — handle tool_use blocks
        await processResponse(response, messages, enhancedSystem, organizationId, userId, selectedModel, sendEvent);

        // Log usage
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'ask_lightspeed', $3, TRUE, NOW())`,
                [organizationId, userId, totalTokens]
            ).catch(_e => {});
        }

        sendEvent({ type: 'done', usage: response.usage || {} });
        res.end();

    } catch (error) {
        console.error('Agentic Ask Lightspeed error:', error);
        sendEvent({ type: 'error', error: error.message || 'Failed to process request' });
        res.end();
    }
});

/**
 * Process Claude's response, handling text blocks and tool_use blocks.
 * For read-only tools (search), executes immediately and loops back.
 * For write tools (create_runway_events), sends a confirmation prompt.
 */
async function processResponse(response, messages, system, organizationId, userId, model, sendEvent) {
    const content = response.content || [];

    // Collect text and tool_use blocks
    let textParts = [];
    let toolUseBlocks = [];

    for (const block of content) {
        if (block.type === 'text') {
            textParts.push(block.text);
        } else if (block.type === 'tool_use') {
            toolUseBlocks.push(block);
        }
    }

    // Send any text content
    if (textParts.length > 0) {
        sendEvent({ type: 'text', content: textParts.join('\n') });
    }

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0) return;

    // Process each tool call
    for (const toolUse of toolUseBlocks) {
        if (toolUse.name === 'create_runway_events') {
            // Write action — send confirmation prompt, don't execute yet
            const events = toolUse.input.events || [];

            // Check for duplicates before confirming
            let duplicates = [];
            try {
                duplicates = await findDuplicateEvents(events, organizationId);
            } catch (_e) { /* continue without duplicate check */ }

            sendEvent({
                type: 'confirm',
                action: 'create_runway_events',
                toolUseId: toolUse.id,
                data: {
                    events,
                    duplicates,
                    message: textParts.join('\n')
                }
            });
            return; // Stop processing — wait for user confirmation

        } else if (toolUse.name === 'search_runway_events') {
            // Read action — execute immediately
            sendEvent({ type: 'status', message: 'Searching Runway calendar...' });
            const results = await executeSearchRunwayEvents(toolUse.input, organizationId);
            const toolResult = results.length > 0
                ? `Found ${results.length} events:\n${results.map(e => `- ${e.event_date}: ${e.title}${e.category ? ' [' + e.category + ']' : ''}`).join('\n')}`
                : 'No matching events found on Runway.';

            // Send tool result back to Claude for final response
            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult }] }
            ];

            const followUp = await claudeService.generateResponse({
                messages: followUpMessages,
                system,
                max_tokens: 4096,
                tools: TOOLS,
                model
            });

            // Recursively process (Claude might call another tool)
            await processResponse(followUp, followUpMessages, system, organizationId, userId, model, sendEvent);
            return;

        } else if (toolUse.name === 'search_knowledge_base') {
            // Read action — execute immediately
            sendEvent({ type: 'status', message: 'Searching Knowledge Base...' });
            const results = await executeSearchKnowledgeBase(toolUse.input, organizationId);
            const toolResult = results.length > 0
                ? `Found ${results.length} relevant KB entries:\n${results.map(e => `[${e.category}] ${e.title}: ${e.content}`).join('\n\n')}`
                : 'No matching knowledge base entries found.';

            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult }] }
            ];

            const followUp = await claudeService.generateResponse({
                messages: followUpMessages,
                system,
                max_tokens: 4096,
                tools: TOOLS,
                model
            });

            await processResponse(followUp, followUpMessages, system, organizationId, userId, model, sendEvent);
            return;

        } else if (toolUse.name === 'draft_content') {
            // Read action — generates draft content using Response Assistant pipeline
            sendEvent({ type: 'status', message: 'Drafting content with brand voice...' });
            const result = await executeDraftContent(toolUse.input, organizationId);
            const toolResult = result.error
                ? `Draft generation failed: ${result.error}`
                : `Here is the drafted ${result.format === 'facebook' ? 'social media post' : 'content'}:\n\n${result.draft}`;

            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult }] }
            ];

            const followUp = await claudeService.generateResponse({
                messages: followUpMessages,
                system,
                max_tokens: 4096,
                tools: TOOLS,
                model
            });

            await processResponse(followUp, followUpMessages, system, organizationId, userId, model, sendEvent);
            return;

        } else if (toolUse.name === 'save_to_knowledge_base') {
            // Write action — requires confirmation
            sendEvent({
                type: 'confirm',
                action: 'save_to_knowledge_base',
                toolUseId: toolUse.id,
                data: {
                    title: toolUse.input.title,
                    content: toolUse.input.content,
                    category: toolUse.input.category,
                    tags: toolUse.input.tags || [],
                    message: textParts.join('\n')
                }
            });
            return; // Stop — wait for user confirmation

        } else if (toolUse.name === 'search_response_history') {
            // Read action — search past responses
            sendEvent({ type: 'status', message: 'Searching past responses...' });
            const results = await executeSearchResponseHistory(toolUse.input, organizationId);
            const toolResult = results.length > 0
                ? `Found ${results.length} past responses:\n${results.map((r, i) => {
                    const date = r.date ? new Date(r.date).toLocaleDateString('en-CA') : 'unknown';
                    return `${i + 1}. [${r.tool}] ${date} by ${r.user || 'Unknown'}:\n   Inquiry: ${r.inquiry}\n   Response: ${r.response}${r.rating ? ' (rated: ' + r.rating + ')' : ''}`;
                }).join('\n\n')}`
                : 'No matching past responses found.';

            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult }] }
            ];

            const followUp = await claudeService.generateResponse({
                messages: followUpMessages,
                system,
                max_tokens: 4096,
                tools: TOOLS,
                model
            });

            await processResponse(followUp, followUpMessages, system, organizationId, userId, model, sendEvent);
            return;

        } else if (toolUse.name === 'run_insights_analysis') {
            // Read action — run data analysis
            sendEvent({ type: 'status', message: 'Running insights analysis...' });
            const result = await executeRunInsightsAnalysis(toolUse.input, organizationId, userId);
            const toolResult = result.error
                ? `Analysis failed: ${result.error}`
                : `Insights Analysis Results:\n\n${result.analysis}`;

            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult }] }
            ];

            const followUp = await claudeService.generateResponse({
                messages: followUpMessages,
                system,
                max_tokens: 4096,
                tools: TOOLS,
                model
            });

            await processResponse(followUp, followUpMessages, system, organizationId, userId, model, sendEvent);
            return;
        }
    }
}

/**
 * POST /api/ask-lightspeed/confirm-action
 *
 * Executes a confirmed write action (e.g., creating calendar events).
 * Called after the user clicks "Confirm" on a confirmation prompt.
 */
router.post('/confirm-action', authenticate, async (req, res) => {
    // SSE response
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
        const { action, events, conversation, system, model, kbEntry } = req.body;
        const organizationId = req.organizationId;
        const userId = req.userId;

        // Handle save_to_knowledge_base confirmation
        if (action === 'save_to_knowledge_base' && kbEntry) {
            sendEvent({ type: 'status', message: 'Saving to Knowledge Base...' });
            const result = await executeSaveToKnowledgeBase(kbEntry, organizationId, userId);

            if (result.saved) {
                sendEvent({ type: 'text', content: `Saved to Knowledge Base: **${result.entry.title}** (${result.entry.category}). This information is now available across all Lightspeed tools.` });
                sendEvent({ type: 'kb_saved', entry: result.entry });
            } else {
                sendEvent({ type: 'text', content: `Failed to save to Knowledge Base: ${result.error}` });
            }
            sendEvent({ type: 'done', usage: {} });
            return res.end();
        }

        if (action !== 'create_runway_events' || !events || !Array.isArray(events)) {
            sendEvent({ type: 'error', error: 'Invalid action or missing data' });
            return res.end();
        }

        sendEvent({ type: 'status', message: `Creating ${events.length} events on Runway...` });

        // Execute the creation
        const { created, errors } = await executeCreateRunwayEvents(events, organizationId, userId);

        // Build a summary for Claude to compose a response
        let summary = '';
        if (created.length > 0) {
            summary += `Successfully created ${created.length} event${created.length > 1 ? 's' : ''} on Runway:\n`;
            created.forEach(e => {
                const date = e.event_date instanceof Date ? e.event_date.toISOString().split('T')[0] : e.event_date;
                summary += `- ${date}: ${e.title}\n`;
            });
        }
        if (errors.length > 0) {
            summary += `\nFailed to create ${errors.length} event${errors.length > 1 ? 's' : ''}:\n`;
            errors.forEach(e => { summary += `- ${e.title} (${e.date}): ${e.error}\n`; });
        }

        // Let Claude compose a nice response
        const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
        const selectedModel = model && ALLOWED_MODELS.includes(model) ? model : undefined;

        const response = await claudeService.generateResponse({
            messages: [
                ...(conversation ? JSON.parse(conversation) : []),
                { role: 'user', content: `The user confirmed creating the events. Here are the results:\n\n${summary}\n\nPlease provide a success summary. If all events were created, include a link suggestion to view the calendar at /runway.` }
            ],
            system: system || 'You are a helpful assistant. Provide a concise summary of the action results.',
            max_tokens: 1024,
            model: selectedModel
        });

        const text = response.content?.find(b => b.type === 'text')?.text || summary;
        sendEvent({ type: 'text', content: text });
        sendEvent({ type: 'events_created', count: created.length, events: created });
        sendEvent({ type: 'done', usage: response.usage || {} });
        res.end();

    } catch (error) {
        console.error('Confirm action error:', error);
        sendEvent({ type: 'error', error: error.message || 'Failed to execute action' });
        res.end();
    }
});

/**
 * POST /api/ask-lightspeed/cancel-action
 *
 * Cancels a pending write action. Returns a cancellation message.
 */
router.post('/cancel-action', authenticate, async (req, res) => {
    res.json({ message: 'No problem, I didn\'t create any events. Let me know if you\'d like to make changes to the schedule or try again.' });
});

// ─── Helper ──────────────────────────────────────────────────────────

function currentUser(req) {
    return { organizationName: req.organizationName || 'your organization' };
}

function buildAgenticSystemPrompt(user) {
    const orgName = user.organizationName || 'your organization';
    return `You are Ask Lightspeed, an AI assistant for lottery operators built into the Lightspeed platform. You work for ${orgName}.

You have access to tools that let you interact with other parts of the platform:

CALENDAR TOOLS:
- search_runway_events: Search existing events on the Runway content calendar
- create_runway_events: Create new events on Runway (requires user confirmation)

KNOWLEDGE & CONTENT TOOLS:
- search_knowledge_base: Search the org's Knowledge Base for policies, procedures, FAQs
- save_to_knowledge_base: Save new information to the KB (requires user confirmation)
- draft_content: Draft professional emails, social posts, and responses using the full content pipeline with brand voice and KB context

ANALYSIS & HISTORY TOOLS:
- search_response_history: Search past AI-generated content across all Lightspeed tools
- run_insights_analysis: Analyze data (sales, customers, sellers, etc.) using the Insights Engine

TOOL USAGE GUIDELINES:
- For file uploads with draw schedules: Parse carefully, then call create_runway_events with all events immediately. The system will show the user a confirmation dialog — you do NOT need to ask for confirmation in text.
- For "remember that..." or "our policy is...": Call save_to_knowledge_base directly. The system handles confirmation.
- For "draft me an email/post about...": Call draft_content with appropriate format and tone
- For "what did I write about X?": Call search_response_history
- For data analysis requests: Call run_insights_analysis with the data
- For policy/procedure questions: Call search_knowledge_base
- For calendar questions: Call search_runway_events

For draw events, use category "Draw" and color "blue" by default. Format titles clearly, e.g., "Draw #47 — $250,000 Jackpot".

IMPORTANT: For write actions (create_runway_events, save_to_knowledge_base), call the tool directly. The system will present a confirmation dialog to the user before executing. Do NOT ask "shall I go ahead?" or "would you like me to create these?" in text — just call the tool and the confirmation UI will handle it. Read-only actions (search, draft, analyze) execute immediately.

Keep responses concise. Use markdown formatting when helpful.`;
}

module.exports = router;
