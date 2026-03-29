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
const { DRAFT_STATIC_PROMPT, buildDraftDynamicPrompt, buildDraftUserPrompt, getMaxTokensForContentType } = require('../services/draftPromptBuilder');
const shopifyService = require('../services/shopify');
const log = require('../services/logger');
const { estimateTokens } = require('../services/tokenCounter');

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
        description: `Draft professional content using the full Draft Assistant pipeline with brand voice, knowledge base, templates, and org context. Supports ALL content types:

CONTENT TYPES (content_type parameter):
- "email": Email copy — new draw announcements, reminders, winner announcements, impact/donor stories, last chance emails. Set email_type for the specific category. Set campaign_mode=true for a 3-email sequence.
- "social": Social media posts for Facebook, Instagram, or LinkedIn. Set platform and variant_count.
- "media-release": Professional media/press releases. Set release_type and include quotes array for leadership quotes.
- "ad": Facebook/Instagram ad copy with structured Headline/Primary Text/Description fields. Set variant_count.
- "write-anything": Free-form content — board reports, grant applications, talking points, internal memos, volunteer recruitment, or any custom content. Set preset for a specific format.

Use this tool whenever the user asks you to draft, write, compose, or generate ANY type of content.`,
        input_schema: {
            type: 'object',
            properties: {
                inquiry: { type: 'string', description: 'The main topic, announcement, or content request. For emails, include the key details. For media releases, describe the announcement. For social posts, describe what to promote.' },
                content_type: { type: 'string', enum: ['email', 'social', 'media-release', 'ad', 'write-anything'], description: 'The type of content to draft. Determines formatting rules and output structure.' },
                details: { type: 'string', description: 'Additional context, key details, or supporting information to include in the content.' },
                tone_name: { type: 'string', enum: ['balanced', 'exciting', 'professional', 'urgent', 'warm', 'formal', 'persuasive', 'conversational'], description: 'Tone for the content. Default "balanced".' },

                // Email-specific
                email_type: { type: 'string', enum: ['new-draw', 'draw-reminder', 'winners', 'impact-sunday', 'last-chance'], description: 'Email category (only for content_type="email"). Determines structure and guidance.' },
                campaign_mode: { type: 'boolean', description: 'If true, generates a 3-email campaign sequence: Announcement → Reminder → Last Chance (only for content_type="email").' },
                email_addons: {
                    type: 'object',
                    description: 'Optional email add-on sections (only for content_type="email").',
                    properties: {
                        subscriptions: { type: 'boolean', description: 'Include subscriptions promo section' },
                        catch_the_ace: { type: 'boolean', description: 'Include Catch The Ace promo section' },
                        other: { type: 'boolean', description: 'Include other program section' }
                    }
                },

                // Social-specific
                platform: { type: 'string', enum: ['facebook', 'instagram', 'linkedin'], description: 'Social media platform (only for content_type="social"). Default "facebook".' },
                variant_count: { type: 'number', description: 'Number of variants to generate (for "social": 1-5, default 3; for "ad": 1-5, default 5).' },

                // Media Release-specific
                release_type: { type: 'string', enum: ['immediate', 'embargo', 'award', 'community-impact'], description: 'Type of media release (only for content_type="media-release"). Default "immediate".' },
                embargo_date: { type: 'string', description: 'Embargo date if release_type is "embargo" (e.g., "April 15, 2026").' },
                quotes: {
                    type: 'array',
                    description: 'Leadership quotes to include in the media release (only for content_type="media-release").',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Person\'s name' },
                            title: { type: 'string', description: 'Person\'s title/role' },
                            text: { type: 'string', description: 'The quote text — what they said or the sentiment to express' }
                        },
                        required: ['name', 'text']
                    }
                },

                // Write Anything-specific
                preset: { type: 'string', enum: ['board-report', 'grant-application', 'talking-points', 'internal-memo', 'volunteer-recruitment'], description: 'Content preset with specific formatting guidance (only for content_type="write-anything"). Omit for freeform.' },
                format_style: { type: 'string', enum: ['paragraphs', 'bullet-points', 'numbered-list', 'outline'], description: 'Output format (only for content_type="write-anything"). Default "paragraphs".' },
                length: { type: 'string', enum: ['brief', 'standard', 'detailed'], description: 'Output length (only for content_type="write-anything"). Default "standard".' },

                // Legacy/general
                agentInstructions: { type: 'string', description: 'Optional special instructions for how to draft the content (e.g., "mention the upcoming draw", "keep it under 3 paragraphs")' }
            },
            required: ['inquiry', 'content_type']
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
        name: 'search_home_base',
        description: 'Search or browse the team\'s Home Base bulletin board for internal posts, announcements, updates, and team communications. Use this to find information shared by team members — urgent notices, draw updates, campaign plans, FYI posts, and other internal knowledge that may not be in the Knowledge Base. You can search by keyword OR browse recent posts by omitting the query.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Optional: search term to find in Home Base posts. If omitted, returns the most recent posts.' },
                category: { type: 'string', enum: ['general', 'urgent', 'fyi', 'draw_update', 'campaign'], description: 'Optional: filter by post category' },
                pinned_only: { type: 'boolean', description: 'If true, only return pinned (important) posts' },
                limit: { type: 'number', description: 'Max results to return (default 10, max 20)' }
            },
            required: []
        }
    },
    {
        name: 'run_insights_analysis',
        description: 'Run an Insights Engine analysis on data the user has uploaded or shared. Use ONLY for analyzing file uploads, spreadsheets, or structured data already provided in the conversation. Do NOT use this for general "how are sales" questions — use search_heartbeat_data instead for live sales performance.',
        input_schema: {
            type: 'object',
            properties: {
                data: { type: 'object', description: 'The data to analyze — can be an object or array of records' },
                reportType: { type: 'string', enum: ['customer_purchases', 'sellers', 'payment_tickets', 'shopify', 'general'], description: 'Type of analysis to run. Use "general" if unsure.' },
                additionalContext: { type: 'string', description: 'Optional extra context or specific questions about the data' }
            },
            required: ['data']
        }
    },
    {
        name: 'search_shopify_orders',
        description: 'Search Shopify orders by order number, email address, or customer name. Use this when the user asks about orders, purchases, transactions, or wants to look up what a customer has bought.',
        input_schema: {
            type: 'object',
            properties: {
                orderNumber: { type: 'string', description: 'Order number to look up (e.g. "1042" or "#1042")' },
                email: { type: 'string', description: 'Customer email to search orders by' },
                customerName: { type: 'string', description: 'Customer name to search orders by (e.g. "Glenn Craig")' }
            },
            required: []
        }
    },
    {
        name: 'search_shopify_customers',
        description: 'Search Shopify customers by name, email, or phone number. Use this when the user asks about customers, supporters, buyers, or wants to look up customer information.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query — can be a name, email, or phone number' }
            },
            required: ['query']
        }
    },
    {
        name: 'search_heartbeat_data',
        description: 'Query real-time and historical raffle sales data from the Heartbeat monitor. Returns current totals (sales, tickets, numbers sold), sales velocity across multiple time windows (1m, 5m, 10m, 30m, 1h, 3h, 24h, 7d), surge detection, package tier breakdowns with numbers-per-ticket, and odds calculations. IMPORTANT: "tickets" are purchases; "numbers" are individual entries in the draw pool. Odds are based on numbers, not tickets. Use this when the user asks about current sales, velocity, how fast tickets are selling, sales trends, revenue totals, odds of winning, or anything related to the live raffle dashboard/heartbeat.',
        input_schema: {
            type: 'object',
            properties: {
                window: { type: 'string', enum: ['1m', '5m', '10m', '30m', '1h', '3h', '24h', '7d', 'all'], description: 'Time window to focus on. Use "all" for a full summary across all windows. Default "all".' },
                include_tiers: { type: 'boolean', description: 'Include package tier breakdown (ticket packages by price point). Default false.' }
            },
            required: []
        }
    },
    {
        name: 'render_chart',
        description: 'Render an interactive chart or graph inline in the conversation. Use this when data would be better understood visually — sales trends, comparisons, distributions, breakdowns, etc. The chart is rendered using Chart.js. Call this tool AFTER you have the data (from Heartbeat, Shopify, Insights, KB, or web search). You may call this alongside your text explanation.',
        input_schema: {
            type: 'object',
            properties: {
                chart_type: {
                    type: 'string',
                    enum: ['bar', 'line', 'pie', 'doughnut', 'horizontalBar'],
                    description: 'Chart type. Use bar for comparisons, line for trends over time, pie/doughnut for proportions, horizontalBar for ranked lists.'
                },
                title: {
                    type: 'string',
                    description: 'Chart title displayed above the chart'
                },
                labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'X-axis labels (categories, dates, names, etc.)'
                },
                datasets: {
                    type: 'array',
                    description: 'One or more data series to plot',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string', description: 'Dataset label (shown in legend)' },
                            data: { type: 'array', items: { type: 'number' }, description: 'Numeric values corresponding to each label' },
                            color: { type: 'string', description: 'Optional color name: blue, green, red, orange, purple, cyan, pink, yellow. Defaults to blue.' }
                        },
                        required: ['label', 'data']
                    }
                }
            },
            required: ['chart_type', 'title', 'labels', 'datasets']
        }
    }
];

// Server-managed tools (executed by Anthropic's API, not by us)
const SERVER_TOOLS = [
    {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5
    }
];

// Combined tools array for API calls
const ALL_TOOLS = [...TOOLS, ...SERVER_TOOLS];

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
            log.warn('PDF parse failed, using basic extraction', { error: err.message });
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

async function executeSearchHomeBase(input, organizationId) {
    const query = input.query;
    const conditions = ['p.organization_id = $1', 'COALESCE(p.archived, false) = false', 'COALESCE(p.is_draft, false) = false'];
    const params = [organizationId];
    let paramIdx = 2;

    if (input.category) {
        conditions.push(`p.category = $${paramIdx}`);
        params.push(input.category);
        paramIdx++;
    }
    if (input.pinned_only) {
        conditions.push('p.pinned = true');
    }

    const limit = Math.min(input.limit || 10, 20);

    // If no query provided, return recent posts (browse mode)
    if (!query) {
        try {
            const result = await pool.query(
                `SELECT p.id, p.body, p.category, p.pinned, p.created_at,
                        u.first_name, u.last_name,
                        COALESCE(c.comment_count, 0)::int AS comment_count
                 FROM home_base_posts p
                 JOIN users u ON u.id = p.author_id
                 LEFT JOIN (
                     SELECT post_id, COUNT(*) AS comment_count
                     FROM home_base_comments
                     GROUP BY post_id
                 ) c ON c.post_id = p.id
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY p.pinned DESC, p.created_at DESC
                 LIMIT $${paramIdx}`,
                [...params, limit]
            );

            return result.rows.map(r => ({
                author: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                category: r.category,
                pinned: r.pinned,
                body: r.body.substring(0, 600),
                comment_count: r.comment_count,
                created_at: r.created_at
            }));
        } catch (_e) {
            return [];
        }
    }

    // Try FTS first
    try {
        conditions.push(`p.search_vector @@ plainto_tsquery('english', $${paramIdx})`);
        params.push(query);

        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.pinned, p.created_at,
                    u.first_name, u.last_name,
                    COALESCE(c.comment_count, 0)::int AS comment_count,
                    ts_rank(p.search_vector, plainto_tsquery('english', $${paramIdx})) AS rank
             FROM home_base_posts p
             JOIN users u ON u.id = p.author_id
             LEFT JOIN (
                 SELECT post_id, COUNT(*) AS comment_count
                 FROM home_base_comments
                 GROUP BY post_id
             ) c ON c.post_id = p.id
             WHERE ${conditions.join(' AND ')}
             ORDER BY p.pinned DESC, rank DESC, p.created_at DESC
             LIMIT $${paramIdx + 1}`,
            [...params, limit]
        );

        if (result.rows.length > 0) {
            return result.rows.map(r => ({
                author: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                category: r.category,
                pinned: r.pinned,
                body: r.body.substring(0, 600),
                comment_count: r.comment_count,
                created_at: r.created_at
            }));
        }
    } catch (_e) { /* FTS may fail, try fallback */ }

    // Fallback: ILIKE search
    try {
        const fallbackConditions = ['p.organization_id = $1', 'COALESCE(p.archived, false) = false', 'COALESCE(p.is_draft, false) = false'];
        const fallbackParams = [organizationId];
        let fbIdx = 2;

        if (input.category) {
            fallbackConditions.push(`p.category = $${fbIdx}`);
            fallbackParams.push(input.category);
            fbIdx++;
        }
        if (input.pinned_only) {
            fallbackConditions.push('p.pinned = true');
        }

        fallbackConditions.push(`p.body ILIKE $${fbIdx}`);
        fallbackParams.push(`%${query}%`);
        fbIdx++;

        const fallback = await pool.query(
            `SELECT p.id, p.body, p.category, p.pinned, p.created_at,
                    u.first_name, u.last_name
             FROM home_base_posts p
             JOIN users u ON u.id = p.author_id
             WHERE ${fallbackConditions.join(' AND ')}
             ORDER BY p.pinned DESC, p.created_at DESC
             LIMIT $${fbIdx}`,
            [...fallbackParams, limit]
        );

        return fallback.rows.map(r => ({
            author: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
            category: r.category,
            pinned: r.pinned,
            body: r.body.substring(0, 600),
            comment_count: 0,
            created_at: r.created_at
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
        const contentType = input.content_type || 'email';

        // Build the dynamic Layer 2 prompt (org context, templates, calendar, rated examples)
        const { dynamic: dynamicSystem, org } = await buildDraftDynamicPrompt(
            organizationId, contentType, input.email_type || null, input.inquiry
        );

        // Enhance Layer 2 with KB entries, rules, voice fingerprint
        const { system: enhancedDynamic } = await buildEnhancedPrompt(
            dynamicSystem, input.inquiry, organizationId,
            { kb_type: 'all', tool: 'draft_assistant', includeCitations: false }
        );

        // Build the content-type-specific user prompt
        const userPrompt = buildDraftUserPrompt(input, org);

        // Add any agent instructions as a prefix
        const finalUserPrompt = input.agentInstructions
            ? `SPECIAL INSTRUCTIONS: ${input.agentInstructions}\n\n${userPrompt}`
            : userPrompt;

        const maxTokens = getMaxTokensForContentType(input);

        // Use the two-layer prompt system (static cached + dynamic)
        const response = await claudeService.streamResponse({
            staticSystem: DRAFT_STATIC_PROMPT,
            dynamicSystem: enhancedDynamic,
            messages: [{ role: 'user', content: finalUserPrompt }],
            max_tokens: maxTokens,
            onText: () => {},   // Collect full text, no streaming needed here
            onDone: () => {}
        });

        const draft = response.text || '';

        // Content type label for the response
        const typeLabels = {
            'email': 'email',
            'social': 'social media post',
            'media-release': 'media release',
            'ad': 'ad copy',
            'write-anything': 'content'
        };

        return { draft, contentType, label: typeLabels[contentType] || 'content' };
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
        customer_purchases: 'Analyze this customer purchase data. Identify revenue trends, top customers (always include a Top 10 Buyers list), purchase patterns, and actionable recommendations. An average orders-per-customer of 1.0–1.2 is normal and healthy for lottery — 1.1 is very good. Highlight repeat buyers as a strength.',
        sellers: 'Analyze this seller performance data. Identify top performers, areas for improvement, and support recommendations.',
        payment_tickets: 'Analyze this payment/ticket data. Summarize status overview, identify issues, and suggest follow-ups.',
        shopify: 'Analyze this Shopify store data. Cover revenue, top products, customer acquisition, fulfillment, and recommendations.',
        general: 'Analyze this data thoroughly. Identify key trends, patterns, anomalies, and provide actionable insights.'
    };

    const domainContext = `You specialize in charitable gaming — 50/50 raffles, Catch The Ace, Fixed Prize Lotteries, and House Lotteries. Key context:
- Sales periods range from one week to four+ months. Sales are naturally cyclical — higher at the start and end of a draw, lower in the middle. This is normal; do not flag mid-draw dips as problems or compute simplistic daily averages.
- Most supporters buy tickets once per draw. An orders-per-customer average of 1.0–1.2 is healthy; 1.1 is very good.
- If the user asks for something beyond the data you have (e.g., "top 100 cities" when you only have 20), be upfront: explain you only have a summary, then suggest Excel (COUNTIF, pivot tables) or their Raffle Service Provider dashboard as alternatives.
- Be encouraging and constructive — these are charitable organizations. Frame recommendations as opportunities, not problems.`;

    const systemPrompt = `You are the Lightspeed Insights Engine, an expert data analyst. ${domainContext}

${REPORT_PROMPTS[reportType] || REPORT_PROMPTS.general}

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
        // Token budget guard – truncate data if the prompt is too large
        let dataStr = JSON.stringify(data);
        const MAX_INPUT_TOKENS = 25000;
        const userContent = `Please analyze this data:\n\n${dataStr}${additionalCtx}`;
        const estimatedTokens = estimateTokens(enhancedSystem) + estimateTokens(userContent);
        if (estimatedTokens > MAX_INPUT_TOKENS) {
            log.warn('[INSIGHTS] Prompt too large, truncating data', { estimated: estimatedTokens, limit: MAX_INPUT_TOKENS });
            const overageChars = (estimatedTokens - MAX_INPUT_TOKENS) * 4;
            const allowedDataChars = Math.max(2000, dataStr.length - overageChars);
            dataStr = dataStr.substring(0, allowedDataChars) + '...[truncated]';
        }

        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: `Please analyze this data:\n\n${dataStr}${additionalCtx}` }],
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

// ─── Heartbeat Data Query ────────────────────────────────────────────

/**
 * Query velocity_snapshots and current feed data for Ask Lightspeed.
 * Returns a text summary of current sales totals, velocity windows, and
 * optionally package tier breakdowns.
 */
async function executeSearchHeartbeatData(input, organizationId) {
    const window = input.window || 'all';
    // include_tiers param kept for backwards compat but tiers are now always fetched

    // Time window definitions (mirrors feedDashboard.js VELOCITY_WINDOWS)
    const WINDOWS = [
        { key: '1m',  label: '1 min',    ms: 1 * 60 * 1000 },
        { key: '5m',  label: '5 min',    ms: 5 * 60 * 1000 },
        { key: '10m', label: '10 min',   ms: 10 * 60 * 1000 },
        { key: '30m', label: '30 min',   ms: 30 * 60 * 1000 },
        { key: '1h',  label: '1 hour',   ms: 60 * 60 * 1000 },
        { key: '3h',  label: '3 hours',  ms: 3 * 60 * 60 * 1000 },
        { key: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
        { key: '7d',  label: '7 days',   ms: 7 * 24 * 60 * 60 * 1000 }
    ];

    try {
        // Load snapshots from the last 7 days, scoped to org
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const result = await pool.query(
            'SELECT ts, total_sales, total_tickets, total_numbers FROM velocity_snapshots WHERE organization_id = $1 AND ts >= $2 ORDER BY ts ASC',
            [organizationId, cutoff]
        );

        const snapshots = result.rows.map(r => ({
            ts: Number(r.ts),
            totalSales: parseFloat(r.total_sales),
            totalTickets: parseInt(r.total_tickets, 10),
            totalNumbers: parseInt(r.total_numbers || 0, 10)
        }));

        if (snapshots.length < 2) {
            return 'Heartbeat has insufficient data — fewer than 2 velocity snapshots recorded. The raffle feed may not be connected or no sales have been recorded yet.';
        }

        const latest = snapshots[snapshots.length - 1];
        const now = latest.ts;

        // Build summary header with current totals
        let summary = `**Heartbeat — Live Raffle Sales Data**\n`;
        summary += `As of: ${new Date(now).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}\n`;
        summary += `Total Sales: $${latest.totalSales.toLocaleString('en-CA', { minimumFractionDigits: 2 })}\n`;
        summary += `Total Tickets Sold: ${latest.totalTickets.toLocaleString()}\n`;
        summary += `Total Numbers Sold (Draw Pool): ${latest.totalNumbers.toLocaleString()}\n`;
        summary += `Data Points: ${snapshots.length} snapshots over the collection period\n\n`;

        // Compute velocity for requested windows
        const windowsToShow = window === 'all'
            ? WINDOWS
            : WINDOWS.filter(w => w.key === window);

        if (windowsToShow.length > 0) {
            summary += `**Sales Velocity:**\n`;
            for (const win of windowsToShow) {
                const winCutoff = now - win.ms;
                const priorCutoff = now - win.ms * 2;

                const windowStart = snapshots.find(s => s.ts >= winCutoff) || snapshots[0];
                const priorStart = snapshots.find(s => s.ts >= priorCutoff) || snapshots[0];

                const salesDelta = latest.totalSales - windowStart.totalSales;
                const ticketsDelta = latest.totalTickets - windowStart.totalTickets;
                const numbersDelta = (latest.totalNumbers || 0) - (windowStart.totalNumbers || 0);
                const priorDelta = windowStart.totalSales - priorStart.totalSales;

                let changeStr = '';
                if (priorDelta > 0) {
                    const pct = Math.round(((salesDelta - priorDelta) / priorDelta) * 100);
                    changeStr = pct >= 0 ? ` (+${pct}% vs prior period)` : ` (${pct}% vs prior period)`;
                }

                summary += `- ${win.label}: $${salesDelta.toLocaleString('en-CA', { minimumFractionDigits: 2 })} revenue, ${ticketsDelta.toLocaleString()} tickets, ${numbersDelta.toLocaleString()} numbers${changeStr}\n`;
            }

            // Surge detection (1h window)
            const hourWindow = WINDOWS.find(w => w.key === '1h');
            if (hourWindow) {
                const hCutoff = now - hourWindow.ms;
                const hPriorCutoff = now - hourWindow.ms * 2;
                const hStart = snapshots.find(s => s.ts >= hCutoff) || snapshots[0];
                const hPrior = snapshots.find(s => s.ts >= hPriorCutoff) || snapshots[0];
                const hSales = latest.totalSales - hStart.totalSales;
                const hPriorSales = hStart.totalSales - hPrior.totalSales;
                if (hPriorSales > 0) {
                    const surgePct = Math.round(((hSales - hPriorSales) / hPriorSales) * 100);
                    if (surgePct >= 50) {
                        summary += `\n**SURGE DETECTED:** Sales are up ${surgePct}% in the last hour compared to the previous hour.\n`;
                    }
                }
            }
        }

        // Always fetch live feed for tier breakdown and accurate numbers data
        try {
            // Look up org's configured sales feed URL
            let FEED_URL = null;
            try {
                const orgFeedResult = await pool.query('SELECT bump_sales_feed_url FROM organizations WHERE id = $1', [organizationId]);
                FEED_URL = orgFeedResult.rows[0]?.bump_sales_feed_url || process.env.DASHBOARD_SALES_FEED_URL || null;
            } catch (_e) { /* no feed URL available */ }
            if (!FEED_URL) throw new Error('No sales feed URL configured');
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '_', parseTagValue: true, trimValues: true, isArray: (name) => name === 'node' });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const resp = await fetch(FEED_URL, { signal: controller.signal, headers: { 'Accept': 'application/xml, text/xml, */*' } });
            clearTimeout(timeout);
            if (resp.ok) {
                const xml = await resp.text();
                const parsed = parser.parse(xml);
                const salesContent = parsed.content || parsed;

                // Live total numbers (most accurate, straight from the feed)
                const liveNumbers = parseInt(String(salesContent.numbers || '0').replace(/,/g, ''), 10) || 0;
                if (liveNumbers > 0 && liveNumbers !== latest.totalNumbers) {
                    summary = summary.replace(
                        /Total Numbers Sold \(Draw Pool\): .+\n/,
                        `Total Numbers Sold (Draw Pool): ${liveNumbers.toLocaleString()}\n`
                    );
                }

                const breakdownNodes = salesContent.breakdown?.node || [];
                const tiers = (Array.isArray(breakdownNodes) ? breakdownNodes : [breakdownNodes]);
                if (tiers.length > 0) {
                    summary += `\n**Package Tier Breakdown:**\n`;
                    for (const t of tiers) {
                        const qty = parseInt(t.quantity) || 0;
                        const price = parseFloat(t.price) || 0;
                        const tickets = parseInt(String(t.total_tickets).replace(/,/g, '')) || 0;
                        const numbers = parseInt(String(t.total_numbers).replace(/,/g, '')) || 0;
                        const sales = parseFloat(String(t.total_sales).replace(/,/g, '')) || 0;
                        summary += `- $${price.toFixed(2)} package (${qty} numbers per ticket): ${tickets.toLocaleString()} tickets sold = ${numbers.toLocaleString()} numbers, $${sales.toLocaleString('en-CA', { minimumFractionDigits: 2 })} revenue\n`;
                    }

                    // Add odds context
                    const totalNumbersLive = liveNumbers || latest.totalNumbers;
                    if (totalNumbersLive > 0) {
                        summary += `\n**Odds Context:**\n`;
                        summary += `Total numbers in the draw pool: ${totalNumbersLive.toLocaleString()}\n`;
                        summary += `Each ticket contains multiple numbers (see tiers above). Odds of winning = [numbers a person holds] in ${totalNumbersLive.toLocaleString()}.\n`;
                        for (const t of tiers) {
                            const qty = parseInt(t.quantity) || 0;
                            const price = parseFloat(t.price) || 0;
                            if (qty > 0) {
                                const oddsRatio = Math.round(totalNumbersLive / qty);
                                summary += `- 1x $${price.toFixed(2)} ticket (${qty} numbers) = 1 in ${oddsRatio.toLocaleString()} odds\n`;
                            }
                        }
                    }
                }
            }
        } catch (_e) {
            summary += `\n(Package tier breakdown unavailable — feed fetch failed.)\n`;
        }

        return summary;
    } catch (err) {
        log.error('Heartbeat data query error', { error: err.message });
        return `Heartbeat data query failed: ${err.message}`;
    }
}

// ─── Web Search Follow-up Suggestions ────────────────────────────────

async function generateAISuggestions(userMessage, assistantResponse) {
    try {
        const response = await claudeService.generateResponse({
            messages: [{
                role: 'user',
                content: `The user just did a web search. Suggest 2-3 follow-up web searches they might want to try next.

USER SEARCHED: ${userMessage.slice(0, 500)}

RESULT SUMMARY: ${assistantResponse.slice(0, 1000)}

Return ONLY a JSON array of objects, each with "label" (short button text, max 5 words), "icon" (single emoji), and "prompt" (the full follow-up search question). Every suggestion must be a follow-up web search question — do NOT suggest drafting content, checking internal tools, or anything else. Only suggest searches that dig deeper into or expand on the topic.

Example format: [{"label":"Compare provincial rules","icon":"🔍","prompt":"What are the provincial regulations for..."},{"label":"Find recent winners","icon":"🔍","prompt":"Who won the largest..."}]

JSON array:`
            }],
            system: 'You generate follow-up web search suggestions. Every suggestion must be a web search question — never suggest internal tools, drafting, or anything else. Keep suggestions tightly related to what was just searched. Return ONLY valid JSON, no markdown fences.',
            max_tokens: 300,
            model: 'claude-haiku-4-5-20251001'
        });

        const text = response.content?.[0]?.text || '';
        // Parse JSON — handle possible markdown fences
        const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
        const suggestions = JSON.parse(cleaned);
        if (Array.isArray(suggestions) && suggestions.length > 0) {
            return suggestions.slice(0, 3).map(s => ({
                label: String(s.label || '').slice(0, 40),
                icon: String(s.icon || '💡').slice(0, 2),
                prompt: String(s.prompt || s.label || '')
            }));
        }
        return [];
    } catch (err) {
        log.warn('AI suggestion generation failed', { error: err.message });
        return [];
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
 *   {type: 'suggestions', items: [...]}          — proactive next-step suggestions
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
        const startTime = Date.now();
        const { message, conversation, model, language, webSearch, dashboardContext, content: rawContent } = req.body;
        const file = req.file;
        const organizationId = req.organizationId;
        const userId = req.userId;

        // Parse structured content blocks (images + text) from form data
        let contentBlocks = null;
        if (rawContent) {
            try { contentBlocks = JSON.parse(rawContent); } catch (_e) { /* ignore */ }
        }

        if (!message && !file && !contentBlocks) {
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
                log.warn('File parse error', { error: err.message });
            }
        }

        // Build the user message with file content and/or structured content blocks
        let userMessage;
        if (contentBlocks && Array.isArray(contentBlocks)) {
            // Structured content (images + text) — append file context to the last text block
            if (fileContext) {
                contentBlocks.push({ type: 'text', text: fileContext });
            }
            userMessage = contentBlocks;
        } else {
            userMessage = fileContext
                ? (message || 'Please analyze the uploaded file.') + fileContext
                : message;
        }

        // Build system prompt with full org profile (always use server-built prompt)
        const orgProfile = await fetchOrgProfile(organizationId);
        const staticSystem = buildAgenticSystemPrompt(orgProfile, { language, webSearch: webSearch === 'true' });

        // Build messages array with cache_control on conversation history
        // Mark the last history message with cache_control so multi-turn
        // conversations cache all prior turns (system + tools + history).
        const historyMessages = conversationHistory.map(m => ({ role: m.role, content: m.content }));
        if (historyMessages.length > 0) {
            const last = historyMessages[historyMessages.length - 1];
            // Wrap string content in a content block array to attach cache_control
            if (typeof last.content === 'string') {
                last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
            } else if (Array.isArray(last.content) && last.content.length > 0) {
                const lastBlock = last.content[last.content.length - 1];
                last.content[last.content.length - 1] = { ...lastBlock, cache_control: { type: 'ephemeral' } };
            }
        }
        const messages = [
            ...historyMessages,
            { role: 'user', content: userMessage }
        ];

        // Enhance with KB, rules, etc. — this becomes the dynamic system layer
        let { system: dynamicSystem } = await buildEnhancedPrompt(
            '', message || '', organizationId,
            { kb_type: 'all', userId, tool: 'ask_lightspeed', includeCitations: true }
        );

        // Inject dashboard context when Ask Lightspeed is invoked from Heartbeat panels
        if (dashboardContext) {
            dynamicSystem += `\n\n--- LIVE DASHBOARD DATA (currently visible to the user) ---\n${dashboardContext}\n--- END DASHBOARD DATA ---\n\nThe user is asking about the data shown above on their Heartbeat dashboard. Use this data to answer their questions directly. You do NOT need to call tools to look up data that is already provided here — just analyze it. Only call tools if the user asks about something not covered by this data (e.g., a specific customer lookup, historical comparisons, or data not shown above).

ANALYTICAL WRITING STYLE — FOLLOW THESE RULES WHEN ANALYZING DASHBOARD DATA:

1. LEAD WITH INSIGHT, NOT METRICS. Do not open with a summary table or a grid of key metrics. Open with the single most interesting or notable finding — stated as a confident, specific observation. Weave key numbers into your narrative naturally. The reader should encounter metrics inside sentences that explain what they mean, not in a table they have to interpret themselves.

2. NEVER DESCRIBE WHAT A CHART OR TABLE ALREADY SHOWS. If the dashboard shows that the $20 tier has the most orders, do not write "The $20 tier has the highest order count." Instead, explain what it means or why it matters: what is the strategic implication? What should the reader do with that information? Every sentence should add insight the data alone does not provide.

3. BE DIRECT AND CONFIDENT. Do not hedge with phrases like "consistent with industry norms," "a well-functioning result," "a healthy metric," or "a solid outcome." If a number is good, say why it is good in concrete terms. If something is underwhelming, say so. The reader is the Director of Charitable Gaming — they want your honest read, not diplomatic padding.

4. TIE EVERY RECOMMENDATION TO A SPECIFIC NUMBER. Never offer generic advice like "consider a targeted message to encourage upgrades." Instead, do the math: "Your 8,023 buyers at $50 represent $401,150 in potential revenue if even 10% moved to $75 — that is a $60,000+ opportunity from a single campaign." Recommendations without math are opinions. Recommendations with math are tools.

5. VARY YOUR RHYTHM. Mix short, punchy observations with longer analytical points. A one-sentence paragraph that lands a key insight is more powerful than burying it inside a block of text. Do not write uniform five-sentence paragraphs throughout — let the structure breathe.

6. TREAT PEOPLE LIKE PEOPLE, NOT DATA ROWS. When discussing top buyers or repeat purchasers, highlight behavioral patterns rather than just listing names and dollar amounts. Focus on what the behavior tells you — habit, loyalty, engagement — not just the numbers.

7. END WITH ONE CLEAR TAKEAWAY, NOT A SUMMARY LIST. Do not end with a bulleted recap. Close with a single paragraph — the one thing the reader should walk away thinking about. If there are five insights, pick the most important one and commit to it.

8. SKIP EXPLANATIONS THE READER ALREADY KNOWS. Do not explain what a ticket tier is, how a raffle works, or what "repeat buyer" means. The reader runs this program. Focus entirely on what this specific data reveals.

9. USE NATURAL SECTION FLOW, NOT RIGID TEMPLATES. Sections should follow from each other logically. Use transitions. If the tier analysis reveals that the $100 tier drives disproportionate revenue, note where those $100 buyers are concentrated. Connect the dots across sections.

10. NO FILLER CLOSINGS. Do not end with generic lines like "This is a strong result and reflects well on the program." If you have made your point, stop. The reader will decide if the result is strong — your job is to give them the evidence.`;
        }

        // Reinforce tool usage after all context injection (KB, rules, memory, etc.)
        // This must come LAST so it isn't buried by appended context.
        dynamicSystem += `\n\nCRITICAL REMINDER — TOOL USAGE:
When the user asks about a specific customer, email address, order, or purchase, you MUST call the search_shopify_orders or search_shopify_customers tool to look up the data. Do NOT tell the user to check Shopify Admin manually. Do NOT say you only have aggregate data. You have real-time Shopify lookup tools — use them.

When the user asks about current sales, velocity, how tickets are selling, revenue pace, sales performance, sales trends, "how are sales", "how are sales today", "how is the raffle doing", or Heartbeat data, you MUST call search_heartbeat_data FIRST. This is the ONLY tool that provides real-time, live sales data. Do NOT call run_insights_analysis or search_shopify_orders for general "how are sales" questions — those tools do not have live velocity data. Do NOT say you don't have access to live sales data — you do via search_heartbeat_data.

CRITICAL — TICKETS vs NUMBERS (ODDS CALCULATIONS):
In charitable gaming raffles, "tickets" and "numbers" are DIFFERENT things:
- A TICKET is a single purchase/transaction (e.g. a $20 ticket or a $100 ticket).
- Each ticket contains multiple NUMBERS (raffle entries). For example, a $20 ticket might have 50 numbers and a $100 ticket might have 700 numbers.
- The DRAW POOL is the total numbers sold across all tickets — this is what determines odds of winning.
- ODDS = [numbers a person holds] in [total numbers in the draw pool]. NOT 1 in [tickets sold].
- When a user asks "what are the odds of winning?" or "what are my chances?", you MUST use the total numbers sold (draw pool size), NOT total tickets. Always call search_heartbeat_data to get accurate numbers data.
- When presenting odds, always clarify which package tier the odds apply to (e.g. "If you bought one $20 ticket with 50 numbers, your odds are 50 in 2,500,000 or about 1 in 50,000").`;

        // Reinforce web search when enabled
        if (webSearch === 'true') {
            dynamicSystem += `\n\nCRITICAL REMINDER — WEB SEARCH:
Web search is ENABLED. For any factual question, external topic, industry information, statistics, regulations, news, or "who/what/when/where" question, you MUST use the web_search tool BEFORE answering. Do NOT answer from memory or training data alone — search the web first to provide accurate, current, and sourced information. The user turned on web search because they want verified, up-to-date answers with sources.`;
        }

        // Whitelist models
        const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];
        const selectedModel = model && ALLOWED_MODELS.includes(model) ? model : undefined;

        // Include web search tool only when explicitly enabled by the user
        const requestTools = webSearch === 'true' ? ALL_TOOLS : TOOLS;

        // Build combined system for tool-use follow-up calls (single string for processResponse)
        const combinedSystem = staticSystem + dynamicSystem;

        // Call Claude with tools — split system for caching, stream text in real-time
        sendEvent({ type: 'status', message: 'Thinking...' });

        const accumulatedTextParts = [];
        const response = await claudeService.generateResponseStream({
            messages,
            staticSystem,
            dynamicSystem,
            max_tokens: 4096,
            tools: requestTools,
            model: selectedModel,
            onText: (chunk) => {
                accumulatedTextParts.push(chunk);
                sendEvent({ type: 'text', content: chunk });
            }
        });

        // Process the response — handle tool_use blocks (text already streamed)
        const trackingSendEvent = (data) => {
            if (data.type === 'text') accumulatedTextParts.push(data.content);
            sendEvent(data);
        };
        await processResponse(response, messages, combinedSystem, organizationId, userId, selectedModel, trackingSendEvent, () => {}, requestTools, true);

        // Emit follow-up suggestions only for web search conversations
        if (webSearch === 'true') {
            const textContent = response.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
            if (textContent) {
                const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                const userText = typeof lastUserMsg?.content === 'string'
                    ? lastUserMsg.content
                    : Array.isArray(lastUserMsg?.content)
                        ? lastUserMsg.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
                        : '';
                const suggestions = await generateAISuggestions(userText, textContent);
                if (suggestions.length > 0) sendEvent({ type: 'suggestions', items: suggestions });
            }
        }

        // Log usage
        const responseTimeMs = Date.now() - startTime;
        if (organizationId && response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, input_tokens, output_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'ask_lightspeed', $3, $4, $5, $6, TRUE, NOW())`,
                [organizationId, userId, totalTokens, response.usage.input_tokens || 0, response.usage.output_tokens || 0, responseTimeMs]
            ).catch(_e => {});
        }

        // Save to response history for cross-tool context
        const fullResponseText = accumulatedTextParts.join('');
        if (organizationId && fullResponseText) {
            const wordCount = fullResponseText.trim().split(/\s+/).length;
            const charCount = fullResponseText.length;
            const userInquiry = typeof message === 'string' ? message : 'Ask Lightspeed conversation';
            pool.query(
                `INSERT INTO response_history (organization_id, user_id, tool, inquiry, response, word_count, char_count, response_time_ms, created_at)
                 VALUES ($1, $2, 'ask_lightspeed', $3, $4, $5, $6, $7, NOW())`,
                [organizationId, userId, userInquiry, fullResponseText, wordCount, charCount, responseTimeMs]
            ).catch(_e => {});
        }

        sendEvent({ type: 'done', usage: response.usage || {} });
        res.end();

    } catch (error) {
        log.error('Agentic Ask Lightspeed error', { error: error.message || error });
        sendEvent({ type: 'error', error: error.message || 'Failed to process request' });
        res.end();
    }
});

// Maximum number of tool-use round-trips before we stop and return a partial
// response. Prevents runaway loops from burning tokens or hanging the request.
const MAX_TOOL_ITERATIONS = 8;

/**
 * Make a streaming follow-up call to Claude after a tool execution, then
 * recursively process the response (which may trigger more tool calls).
 * Text chunks are streamed to the client in real-time via sendEvent.
 */
async function streamFollowUp(followUpMessages, system, max_tokens, tools, model, organizationId, userId, sendEvent, trackTool, depth = 0) {
    const followUp = await claudeService.generateResponseStream({
        messages: followUpMessages,
        system,
        max_tokens,
        tools,
        model,
        onText: (chunk) => { sendEvent({ type: 'text', content: chunk }); }
    });
    await processResponse(followUp, followUpMessages, system, organizationId, userId, model, sendEvent, trackTool, tools, true, depth);
}

/**
 * Process Claude's response, handling text blocks and tool_use blocks.
 * For read-only tools (search), executes immediately and loops back.
 * For write tools (create_runway_events), sends a confirmation prompt.
 *
 * @param {number} depth - Current tool-loop iteration count (0-based).
 */
async function processResponse(response, messages, system, organizationId, userId, model, sendEvent, trackTool, tools, textAlreadyStreamed, depth = 0) {
    const content = response.content || [];

    // Log content block types for debugging web search
    const blockTypes = content.map(b => b.type);
    if (blockTypes.some(t => t === 'server_tool_use' || t === 'web_search_tool_result')) {
        log.info('Web search blocks detected', { blockTypes });
    }

    // Collect text, tool_use, and web search source blocks
    let textParts = [];
    let toolUseBlocks = [];
    let webSources = [];

    for (const block of content) {
        if (block.type === 'text') {
            textParts.push(block.text);
        } else if (block.type === 'tool_use') {
            toolUseBlocks.push(block);
        } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            // Extract source URLs from web search results
            for (const result of block.content) {
                if (result.type === 'web_search_result' && result.url) {
                    webSources.push({ url: result.url, title: result.title || result.url });
                }
            }
        }
        // server_tool_use — handled server-side, no action needed
    }

    // Send text content (skip if already streamed in real-time via onText callback)
    if (!textAlreadyStreamed && textParts.length > 0) {
        sendEvent({ type: 'text', content: textParts.join('\n') });
    }

    // Send web search sources if present
    if (webSources.length > 0) {
        sendEvent({ type: 'sources', items: webSources });
    }

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0) return;

    // Guard against runaway tool loops
    if (depth >= MAX_TOOL_ITERATIONS) {
        log.warn('Ask Lightspeed tool loop hit max iterations', { depth, organizationId, tools: toolUseBlocks.map(t => t.name) });
        sendEvent({ type: 'text', content: '\n\nI\'ve reached the maximum number of tool calls for this request. Here\'s what I have so far — feel free to ask a follow-up if you need more.' });
        return;
    }

    // Helper: build tool_result array for all tool_use blocks in this response.
    // The active tool gets the real result; others get a skip message.
    // This prevents the Claude API error about missing tool_result blocks.
    function buildToolResults(activeToolId, activeResult) {
        return toolUseBlocks.map(t => ({
            type: 'tool_result',
            tool_use_id: t.id,
            content: t.id === activeToolId ? activeResult : 'Skipped — only one tool is processed per turn.'
        }));
    }

    // Process the first tool call (Claude may return multiple, but we handle one at a time)
    const toolUse = toolUseBlocks[0];
    {
        // Track which tool is being executed for proactive suggestions
        if (trackTool) trackTool(toolUse.name, toolUse.input);

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

            // Send tool result back to Claude for streaming follow-up
            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
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
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            return;

        } else if (toolUse.name === 'draft_content') {
            // Read action — generates draft content using full Draft Assistant pipeline
            const contentTypeStatus = {
                'email': 'Drafting email with brand voice...',
                'social': 'Drafting social media post...',
                'media-release': 'Drafting media release...',
                'ad': 'Generating ad copy variants...',
                'write-anything': 'Drafting content...'
            };
            sendEvent({ type: 'status', message: contentTypeStatus[toolUse.input.content_type] || 'Drafting content with brand voice...' });
            const result = await executeDraftContent(toolUse.input, organizationId);

            if (result.error) {
                // Draft failed — let Claude handle the error message
                const toolResult = `Draft generation failed: ${result.error}`;
                const followUpMessages = [
                    ...messages,
                    { role: 'assistant', content: response.content },
                    { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
                ];

                await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            } else {
                // Draft succeeded — send the full draft directly to the user
                sendEvent({ type: 'text', content: result.draft });

                // Let Claude add a brief follow-up (review notes, suggestions, etc.)
                const toolResult = `The drafted ${result.label || 'content'} has been displayed to the user. Provide a brief follow-up: mention any placeholders or details the user should review, and offer to make adjustments. Do NOT repeat or re-output the draft content — the user can already see it.`;
                const followUpMessages = [
                    ...messages,
                    { role: 'assistant', content: response.content },
                    { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
                ];

                await streamFollowUp(followUpMessages, system, 1024, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            }
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
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            return;

        } else if (toolUse.name === 'search_home_base') {
            // Read action — search Home Base posts
            sendEvent({ type: 'status', message: 'Searching Home Base...' });
            const results = await executeSearchHomeBase(toolUse.input, organizationId);
            const toolResult = results.length > 0
                ? `Found ${results.length} Home Base posts:\n${results.map((r, i) => {
                    const date = r.created_at ? new Date(r.created_at).toLocaleDateString('en-CA') : 'unknown';
                    return `${i + 1}. [${r.category}]${r.pinned ? ' [PINNED]' : ''} by ${r.author} (${date}):\n   ${r.body}${r.comment_count ? ` (${r.comment_count} comments)` : ''}`;
                }).join('\n\n')}`
                : 'No matching Home Base posts found.';

            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
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
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            return;

        } else if (toolUse.name === 'search_shopify_orders') {
            // Read action — search Shopify orders
            sendEvent({ type: 'status', message: 'Searching Shopify orders...' });
            let toolResult;
            try {
                const { orderNumber, email, customerName } = toolUse.input;
                let orders = await shopifyService.lookupOrder(organizationId, { orderNumber, email, customerName });
                if (!Array.isArray(orders)) orders = orders ? [orders] : [];
                toolResult = orders.length > 0
                    ? `Found ${orders.length} order(s):\n\n${JSON.stringify(orders, null, 2)}`
                    : 'No orders found matching your search criteria.';
            } catch (err) {
                log.error('Shopify order search error', { error: err.message || err });
                toolResult = `Order search failed: ${err.message}`;
            }

            trackTool('search_shopify_orders');
            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            return;

        } else if (toolUse.name === 'search_shopify_customers') {
            // Read action — search Shopify customers
            sendEvent({ type: 'status', message: 'Searching Shopify customers...' });
            let toolResult;
            try {
                const { query } = toolUse.input;
                const customers = await shopifyService.searchCustomers(organizationId, query);
                toolResult = customers.length > 0
                    ? `Found ${customers.length} customer(s):\n\n${JSON.stringify(customers, null, 2)}`
                    : 'No customers found matching your search.';
            } catch (err) {
                log.error('Shopify customer search error', { error: err.message || err });
                toolResult = `Customer search failed: ${err.message}`;
            }

            trackTool('search_shopify_customers');
            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            return;

        } else if (toolUse.name === 'search_heartbeat_data') {
            // Read action — query Heartbeat velocity/sales data
            sendEvent({ type: 'status', message: 'Querying Heartbeat sales data...' });
            const toolResult = await executeSearchHeartbeatData(toolUse.input, organizationId);

            trackTool('search_heartbeat_data');
            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 4096, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
            return;

        } else if (toolUse.name === 'render_chart') {
            // Visual tool — send chart config to frontend for rendering
            const { chart_type, title, labels, datasets } = toolUse.input;
            sendEvent({
                type: 'chart',
                config: { chart_type, title, labels, datasets }
            });

            trackTool('render_chart');

            // Tell Claude the chart was rendered so it can add commentary
            const toolResult = `The ${chart_type} chart "${title}" has been rendered and displayed to the user. You may add a brief text summary or analysis of the data shown in the chart, but do NOT reproduce the raw numbers — the user can see them in the chart.`;
            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: buildToolResults(toolUse.id, toolResult) }
            ];

            await streamFollowUp(followUpMessages, system, 2048, tools, model, organizationId, userId, sendEvent, trackTool, depth + 1);
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
        const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];
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
        log.error('Confirm action error', { error: error.message || error });
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

async function fetchOrgProfile(organizationId) {
    try {
        const result = await pool.query(
            `SELECT name, website_url, support_email, store_location, licence_number,
                    cta_website_url, ceo_name, ceo_title, media_contact_name,
                    media_contact_email, mission, default_draw_time, ticket_deadline_time,
                    social_required_line, brand_terminology, email_addons
             FROM organizations WHERE id = $1`,
            [organizationId]
        );
        return result.rows[0] || {};
    } catch (_e) {
        return {};
    }
}

function buildAgenticSystemPrompt(org, options = {}) {
    const orgName = org.name || 'your organization';
    const { language, webSearch } = options;

    // Tone is always professional
    const toneDesc = 'professional and helpful';

    const LANG_MAP = {
        fr: '\nLANGUAGE: You MUST write your entire response in French (Français). The customer inquiry may be in any language, but your response must always be in French.\n',
        es: '\nLANGUAGE: You MUST write your entire response in Spanish (Español). The customer inquiry may be in any language, but your response must always be in Spanish.\n'
    };
    const langInstruction = LANG_MAP[language] || '';

    // Build organization profile section from Teams/Manage data
    let orgProfile = `\nORGANIZATION PROFILE (from the Teams page under Manage):\n- Organization: ${orgName}`;
    if (org.website_url) orgProfile += `\n- Lottery Website: ${org.website_url}`;
    if (org.support_email) orgProfile += `\n- Support Email: ${org.support_email}`;
    if (org.store_location) orgProfile += `\n- In-Person Location: ${org.store_location}`;
    if (org.licence_number) orgProfile += `\n- Licence Number: ${org.licence_number}`;
    if (org.cta_website_url) orgProfile += `\n- Catch The Ace Website: ${org.cta_website_url}`;
    if (org.ceo_name) orgProfile += `\n- CEO/President: ${org.ceo_name}${org.ceo_title ? ` (${org.ceo_title})` : ''}`;
    if (org.media_contact_name) orgProfile += `\n- Media Contact: ${org.media_contact_name}${org.media_contact_email ? ` (${org.media_contact_email})` : ''}`;
    if (org.mission) orgProfile += `\n- Mission: ${org.mission}`;
    if (org.default_draw_time) orgProfile += `\n- Default Draw Time: ${org.default_draw_time}`;
    if (org.ticket_deadline_time) orgProfile += `\n- Ticket Deadline Time: ${org.ticket_deadline_time}`;
    if (org.social_required_line) orgProfile += `\n- Social Required Line: ${org.social_required_line}`;
    if (org.brand_terminology) {
        try {
            const terms = typeof org.brand_terminology === 'string' ? JSON.parse(org.brand_terminology) : org.brand_terminology;
            if (terms && Object.keys(terms).length > 0) {
                orgProfile += `\n- Brand Terminology: ${JSON.stringify(terms)}`;
            }
        } catch (_e) { /* skip */ }
    }
    if (org.email_addons) {
        try {
            const addons = typeof org.email_addons === 'string' ? JSON.parse(org.email_addons) : org.email_addons;
            if (addons && Object.keys(addons).length > 0) {
                orgProfile += `\n- Email Add-ons: ${JSON.stringify(addons)}`;
            }
        } catch (_e) { /* skip */ }
    }

    if (org.website_url) {
        orgProfile += `\n\nIMPORTANT: Only use the URLs listed above. Do NOT invent or guess other URLs, licence numbers, or contact information.`;
    }

    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    return `You are Ask Lightspeed, an AI assistant for lottery operators built into the Lightspeed platform. You work for ${orgName}.

TODAY'S DATE: ${dayOfWeek}, ${today}
TONE: Respond in a ${toneDesc} tone.
${langInstruction}${orgProfile}

You have access to tools that let you interact with other parts of the platform:

CALENDAR TOOLS:
- search_runway_events: Search existing events on the Runway content calendar
- create_runway_events: Create new events on Runway (requires user confirmation)

KNOWLEDGE & CONTENT TOOLS:
- search_knowledge_base: Search the org's Knowledge Base for policies, procedures, FAQs
- save_to_knowledge_base: Save new information to the KB (requires user confirmation)
- draft_content: Draft professional content using the FULL Draft Assistant pipeline with brand voice, templates, knowledge base, and org context. Supports ALL content types:

  DRAFT_CONTENT — CONTENT TYPES:
  1. content_type="email": Email copy. Set email_type to one of: "new-draw", "draw-reminder", "winners", "impact-sunday", "last-chance". Set campaign_mode=true for a 3-email sequence (Announcement → Reminder → Last Chance). Can include email_addons for subscriptions/catch-the-ace sections.
  2. content_type="social": Social media posts. Set platform ("facebook", "instagram", "linkedin") and variant_count (1-5). Each variant is distinct with different hooks and angles.
  3. content_type="media-release": Professional media/press releases. Set release_type ("immediate", "embargo", "award", "community-impact"). Include quotes array with name/title/text for leadership quotes. Set embargo_date for embargoed releases.
  4. content_type="ad": Facebook/Instagram ad copy. Outputs structured Headline (40 chars) / Primary Text (125 chars) / Description (30 chars) per variant. Set variant_count (1-5).
  5. content_type="write-anything": Free-form content. Set preset for specific formats: "board-report", "grant-application", "talking-points", "internal-memo", "volunteer-recruitment". Or omit preset for freeform. Set format_style, length, and tone_name.

  IMPORTANT RULES FOR draft_content:
  - ALWAYS set content_type — this determines which Draft Assistant pipeline is used
  - For media releases, extract and pass quotes as structured data in the quotes array
  - For social posts, pass the platform and desired variant_count
  - For emails, set the email_type to get category-specific guidance
  - The inquiry field should contain the topic/announcement/details — be thorough
  - Use the details field for additional context the user provides
  - Set tone_name to match the user's requested tone (default "balanced")

TEAM & INTERNAL TOOLS:
- search_home_base: Search or browse the team's Home Base bulletin board for internal posts, announcements, urgent notices, draw updates, campaign plans, and other team communications. Posts may contain important operational details, decisions, or context shared by team members. You can search by keyword (query parameter) OR browse recent posts by omitting the query parameter. Use browse mode (no query) when the user asks for "latest posts", "recent updates", "what's new", or wants a summary of recent activity.

SHOPIFY TOOLS:
- search_shopify_orders: Search Shopify orders by order number, email, or customer name. Use when the user asks about orders, purchases, or what a customer has bought.
- search_shopify_customers: Search Shopify customers by name, email, or phone. Use when the user asks about customers, supporters, or buyers.

HEARTBEAT (LIVE RAFFLE MONITOR):
- search_heartbeat_data: Query real-time raffle sales data from the Heartbeat monitor. Returns current totals (revenue, tickets sold, numbers sold / draw pool size), sales velocity across time windows (1m to 7d), surge detection, package tier breakdowns with numbers-per-ticket multipliers, and odds calculations per package. Use when the user asks about current sales, velocity, odds of winning, draw pool size, or anything related to live raffle metrics. Remember: "tickets" = purchases, "numbers" = individual raffle entries. Odds are always based on numbers, not tickets.

${webSearch ? `WEB SEARCH (ENABLED):
- web_search: Search the internet for current, verified information. This is a server-managed tool — call it and the results are provided automatically.
- CRITICAL: The user has enabled web search for this conversation. You MUST use web_search for ANY question about facts, events, statistics, organizations, regulations, news, best practices, or anything that benefits from up-to-date or verifiable information. Do NOT answer factual questions from memory alone — always search first to provide accurate, sourced answers.
- The ONLY exceptions where you should skip web search: questions answered by the organization's own Knowledge Base, calendar, Shopify data, or Home Base. For those, use internal tools instead.
- After using web search, your response will automatically include source links for the user.

` : ''}VISUALIZATION:
- render_chart: Render an interactive chart or graph inline in the conversation. Use this AFTER you have data to visualize — from Heartbeat, Shopify, Insights, KB, or web search. Supported types: bar, line, pie, doughnut, horizontalBar. Provide a title, labels array, and one or more datasets with numeric data. Use this proactively when data would be clearer as a visual — sales trends, comparisons, breakdowns, distributions. You can call render_chart and include text explanation in the same response.

ANALYSIS & HISTORY TOOLS:
- search_response_history: Search past AI-generated content across all Lightspeed tools
- run_insights_analysis: Analyze uploaded or user-provided data (spreadsheets, file uploads, etc.) using the Insights Engine. NOT for general "how are sales" questions — use search_heartbeat_data for that.

TOOL USAGE GUIDELINES:
- For file uploads with draw schedules: Parse carefully, then call create_runway_events with all events immediately. The system will show the user a confirmation dialog — you do NOT need to ask for confirmation in text.
- For "remember that..." or "our policy is...": Call save_to_knowledge_base directly. The system handles confirmation.
- For "draft/write/compose me a..." requests: Call draft_content with the appropriate content_type and parameters. ALWAYS call the tool — never just write content inline without it. The tool uses the full Draft Assistant pipeline with brand voice, knowledge base, templates, and org context.
- For "media release", "press release": Call draft_content with content_type="media-release"
- For "social post", "Facebook post", "Instagram post": Call draft_content with content_type="social"
- For "email", "newsletter", "email blast": Call draft_content with content_type="email"
- For "ad", "ad copy", "Facebook ad": Call draft_content with content_type="ad"
- For "board report", "memo", "grant application", "talking points", or any other written content: Call draft_content with content_type="write-anything"
- For "what did I write about X?": Call search_response_history
- For order lookups ("any orders under...", "order #1042", "what did X buy?"): Call search_shopify_orders with the appropriate parameter (orderNumber, email, or customerName)
- For customer lookups ("find customer...", "who is...", "look up..."): Call search_shopify_customers with the query
- For data analysis requests: Call run_insights_analysis with the data
- For current sales, velocity, "how are sales going?", "how are sales today?", "how is the raffle doing?", "how fast are tickets selling?", heartbeat metrics, sales performance, or live raffle performance: Call search_heartbeat_data FIRST. This is your go-to tool for any general "how are sales" question. Use window parameter to focus on a specific time range, or "all" for a full overview. Do NOT use run_insights_analysis or Shopify tools for these questions.
- For odds of winning, chances, probability, or draw pool size: Call search_heartbeat_data. The tool returns total numbers in the draw pool and per-package breakdowns. Remember: odds are based on NUMBERS (raffle entries), not tickets (purchases). Each ticket contains multiple numbers depending on the package tier.
- For visualizing data: Call render_chart after you have retrieved the data. Use bar charts for comparisons, line charts for trends over time, pie/doughnut for proportions, horizontalBar for ranked lists. When the user asks to "show me", "graph", "chart", "visualize", or when numeric data would benefit from a visual, proactively render a chart.
${webSearch ? `- For ANY factual question, external topic, industry question, regulation, news, statistics, or "who/what/when/where" questions: You MUST call web_search. Do not rely on training data for factual claims — search first. The only exception is questions answerable from internal tools (KB, calendar, Shopify, Home Base).
` : ''}- For policy/procedure questions: Call search_knowledge_base
- For team announcements, internal updates, or "what did the team post about X?": Call search_home_base with a query
- For "latest post", "recent posts", "what's new in home base", or "summarize home base": Call search_home_base WITHOUT a query to browse recent posts
- For calendar questions: Call search_runway_events

For draw events, use category "Draw" and color "blue" by default. Format titles clearly, e.g., "Draw #47 — $250,000 Jackpot".

IMPORTANT: For write actions (create_runway_events, save_to_knowledge_base), call the tool directly. The system will present a confirmation dialog to the user before executing. Do NOT ask "shall I go ahead?" or "would you like me to create these?" in text — just call the tool and the confirmation UI will handle it. Read-only actions (search, draft, analyze) execute immediately.

CRITICAL: When the user asks you to draft or write ANY content, you MUST call the draft_content tool. Do NOT write content directly in your response without calling the tool first. The draft_content tool gives you access to the organization's brand voice, knowledge base, content templates, calendar events, and response rules — writing content without it will produce generic output that misses the organization's context and style.

KNOWLEDGE & ACCURACY:
- Do NOT speculate or present general knowledge as fact. Only state information that comes from the organization's knowledge base, calendar, Shopify data, or other connected tools.
- If you do not have verified information to answer a question, say so directly. Do not guess, fabricate, or fill in gaps with training data assumptions.
- Never present unverified claims as though they are sourced or authoritative. "I don't have that information" is always better than a confident wrong answer.
- If a user's question falls outside charitable gaming, nonprofit lotteries, or raffle operations, do not attempt to answer using general knowledge. Instead, be transparent that the topic is outside your expertise and redirect to your core purpose. Never speculate. Never hallucinate. Frame this warmly, not robotically — you're being honest, not reciting a disclaimer. For example: "That's outside my area of expertise, so I don't want to guess. I'm built to help with charitable gaming and nonprofit lottery operations — anything in that wheelhouse, I'm your person."

FORMATTING & STYLE RULES:
- NEVER use emojis — no icons, symbols, or pictographs of any kind.
- NEVER use italics (*text* or _text_).
- NEVER use markdown headers (#, ##, ###). Use **bold text** for section labels if needed.
- Respond in paragraph form. You may combine paragraphs with bulleted lists when listing multiple items, but always include at least one paragraph of context — never respond with only a bulleted list. If there are only 1-2 points, write them as sentences, not bullets.
- Use bold for emphasis when needed.
- Do NOT open with filler phrases like "Certainly!", "Of course!", "Absolutely!", "Great question!", "Sure thing!", or "That's a great question!". Lead with the answer or the substance.
- Do NOT end with sign-offs like "Let me know if you need anything else!", "Hope that helps!", "Happy to help!", or "Feel free to ask!". Just stop when you're done.
- Do NOT hedge unnecessarily — avoid "I think", "It seems like", "If I understand correctly" when the request is clear. Be direct.
- Match the user's energy — a short question gets a short answer, a detailed question gets a detailed answer. Do not over-explain simple things.
- Only use numbered lists when order matters (steps, instructions). For unordered items, use bullets or prose.
- Do NOT repeat the user's question back to them. No "You're asking about X." — just answer.
- Do NOT narrate what you're about to do. No "Let me look into that for you" or "I'll help you with that." Just do it.
- Use contractions naturally — "don't" not "do not", "it's" not "it is", "you'll" not "you will". Write like a person.
- Do NOT refer to yourself as an AI, assistant, or by name. No "As an AI assistant..." or "As Lightspeed AI...". Just answer the question.
- Do NOT apologize unnecessarily. No "I'm sorry, but..." or "Unfortunately, I'm unable to..." — just state the fact directly.
- Do NOT use filler phrases like "please note", "it's worth noting", "it's important to mention", or "keep in mind". If it's worth saying, just say it.
- Vary your transitions — don't start every counterpoint with "However". Sometimes just start the sentence.
- Use plain language — no "leverage", "utilize", "facilitate", "in order to", "at this time", "as per". Say "use", "help", "to", "now", "per".

Keep responses concise.`;
}

module.exports = router;
