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
        description: 'Create one or more events on the Runway content calendar. Use this when the user asks you to add events, draws, deadlines, or scheduled items to the calendar. Always confirm with the user before calling this tool — present the list of events you plan to create and wait for their approval.',
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
        const { action, events, conversation, system, model } = req.body;
        const organizationId = req.organizationId;
        const userId = req.userId;

        if (action !== 'create_runway_events' || !events || !Array.isArray(events)) {
            sendEvent({ type: 'error', error: 'Invalid action or missing events' });
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
- You can search and create events on Runway (the content calendar) — use this for draw schedules, campaign deadlines, and team events
- You can search the Knowledge Base for information about lottery operations and policies

When a user uploads a file containing a draw schedule or event list:
1. Parse the file carefully — extract all dates, event names, times, jackpot amounts, and any other relevant details
2. Present a clear, formatted summary of the events you found and what you plan to create on Runway
3. Call the create_runway_events tool with the parsed events — the system will ask the user to confirm before creating anything
4. After confirmation, the events will be created and you'll provide a summary

When answering questions:
- Check Runway for upcoming draws and deadlines when relevant
- Search the Knowledge Base for policy and procedure questions
- Always be specific about dates and times — don't guess, use the data from your tools

For draw events, use the category "Draw" and color "blue" by default. Format draw titles clearly, e.g., "Draw #47 — $250,000 Jackpot" or "Friday Night Draw — June 15".

Always confirm before taking any action that creates, modifies, or deletes data.

Keep responses concise. Use markdown formatting when helpful.`;
}

module.exports = router;
