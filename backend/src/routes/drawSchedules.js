/**
 * Draw Schedules Routes
 * CRUD operations + document upload for org-specific draw schedules
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const { generateResponse } = require('../services/claude');
const multer = require('multer');
const mammoth = require('mammoth');

// Configure multer for in-memory file uploads (max 10MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.originalname.endsWith('.docx') ||
            file.mimetype === 'text/plain' ||
            file.originalname.endsWith('.txt')) {
            cb(null, true);
        } else {
            cb(new Error('Only .docx and .txt files are supported'));
        }
    }
});

/**
 * GET /api/draw-schedules
 * Get active draw schedule for user's organization
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `SELECT * FROM draw_schedules
             WHERE organization_id = $1
             ORDER BY is_active DESC, created_at DESC`,
            [organizationId]
        );

        res.json({ schedules: result.rows });

    } catch (error) {
        console.error('Get draw schedules error:', error);
        res.status(500).json({ error: 'Failed to get draw schedules' });
    }
});

/**
 * GET /api/draw-schedules/active
 * Get only the active draw schedule for user's organization
 */
router.get('/active', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `SELECT * FROM draw_schedules
             WHERE organization_id = $1 AND is_active = TRUE
             ORDER BY created_at DESC
             LIMIT 1`,
            [organizationId]
        );

        res.json({ schedule: result.rows[0] || null });

    } catch (error) {
        console.error('Get active draw schedule error:', error);
        res.status(500).json({ error: 'Failed to get active draw schedule' });
    }
});

/**
 * POST /api/draw-schedules
 * Create a new draw schedule (manually)
 */
router.post('/', authenticate, [
    body('drawName').notEmpty().withMessage('Draw name required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const {
            drawName, grandPrizeDate, ticketSalesStart, ticketSalesEnd,
            guaranteedPrize, prizeDescription, earlyBirds, pricing, rawSourceText
        } = req.body;

        // Deactivate any existing active schedule for this org
        await pool.query(
            'UPDATE draw_schedules SET is_active = FALSE, updated_at = NOW() WHERE organization_id = $1 AND is_active = TRUE',
            [organizationId]
        );

        const id = uuidv4();
        const result = await pool.query(
            `INSERT INTO draw_schedules (id, organization_id, draw_name, grand_prize_date, ticket_sales_start, ticket_sales_end, guaranteed_prize, prize_description, early_birds, pricing, raw_source_text, is_active, created_by, updated_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12, $12, NOW(), NOW())
             RETURNING *`,
            [id, organizationId, drawName, grandPrizeDate || null, ticketSalesStart || null, ticketSalesEnd || null, guaranteedPrize || null, prizeDescription || null, JSON.stringify(earlyBirds || []), JSON.stringify(pricing || []), rawSourceText || null, req.userId]
        );

        res.status(201).json({ schedule: result.rows[0] });

    } catch (error) {
        console.error('Create draw schedule error:', error);
        res.status(500).json({ error: 'Failed to create draw schedule' });
    }
});

/**
 * POST /api/draw-schedules/upload
 * Upload a Rules of Play document and parse it into a draw schedule using AI
 */
router.post('/upload', authenticate, upload.single('document'), async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        // Get the text content - either from file upload or pasted text
        let rawText = '';

        if (req.file) {
            if (req.file.originalname.endsWith('.docx')) {
                const result = await mammoth.extractRawText({ buffer: req.file.buffer });
                rawText = result.value;
            } else {
                rawText = req.file.buffer.toString('utf8');
            }
        } else if (req.body.text) {
            rawText = req.body.text;
        } else {
            return res.status(400).json({ error: 'No document or text provided' });
        }

        if (!rawText.trim()) {
            return res.status(400).json({ error: 'Document appears to be empty' });
        }

        // Use Claude to parse the document into structured draw schedule data
        const parseResponse = await generateResponse({
            system: `You are a data extraction assistant. Extract draw schedule information from lottery Rules of Play documents. Return ONLY valid JSON with no additional text or markdown formatting.

The JSON must follow this exact structure:
{
    "drawName": "string - the name/title of the draw (e.g., 'Draw #5 - February 2026')",
    "grandPrizeDate": "ISO 8601 datetime or null",
    "ticketSalesStart": "ISO 8601 datetime or null",
    "ticketSalesEnd": "ISO 8601 datetime or null",
    "guaranteedPrize": "string - dollar amount (e.g., '$5,000') or null",
    "prizeDescription": "string - description of prize structure or null",
    "earlyBirds": [
        {
            "number": "string or number - the early bird number(s) (e.g., 1 or '2-6')",
            "date": "YYYY-MM-DD",
            "day": "day of week (e.g., 'Wednesday')",
            "prize": "string - dollar amount (e.g., '$10,000')",
            "quantity": 1
        }
    ],
    "pricing": [
        {
            "price": "string - dollar amount (e.g., '$20')",
            "numbers": "number - how many numbers/entries the price gets"
        }
    ]
}

Rules:
- Extract ALL early bird draws with their dates, prizes, and quantities
- Extract ALL pricing tiers
- Use ISO 8601 format for dates (include time if specified, e.g., "2026-02-27T11:00:00")
- If information is not found, use null for that field
- Return ONLY the JSON object, no explanation`,
            messages: [{ role: 'user', content: `Extract the draw schedule from this document:\n\n${rawText.substring(0, 15000)}` }],
            max_tokens: 4096
        });

        let parsed;
        try {
            const aiText = parseResponse.content[0].text.trim();
            // Strip markdown code fences if present
            const jsonStr = aiText.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
            parsed = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('Failed to parse AI response:', parseErr);
            return res.status(422).json({
                error: 'Could not parse the document automatically. Please try pasting the schedule text or entering it manually.',
                rawText: rawText.substring(0, 2000)
            });
        }

        // Deactivate existing active schedules
        await pool.query(
            'UPDATE draw_schedules SET is_active = FALSE, updated_at = NOW() WHERE organization_id = $1 AND is_active = TRUE',
            [organizationId]
        );

        // Save the parsed schedule
        const id = uuidv4();
        const result = await pool.query(
            `INSERT INTO draw_schedules (id, organization_id, draw_name, grand_prize_date, ticket_sales_start, ticket_sales_end, guaranteed_prize, prize_description, early_birds, pricing, raw_source_text, is_active, created_by, updated_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12, $12, NOW(), NOW())
             RETURNING *`,
            [id, organizationId, parsed.drawName || 'Uploaded Schedule', parsed.grandPrizeDate || null, parsed.ticketSalesStart || null, parsed.ticketSalesEnd || null, parsed.guaranteedPrize || null, parsed.prizeDescription || null, JSON.stringify(parsed.earlyBirds || []), JSON.stringify(parsed.pricing || []), rawText, req.userId]
        );

        res.status(201).json({
            message: `Draw schedule parsed and saved successfully`,
            schedule: result.rows[0]
        });

    } catch (error) {
        console.error('Upload draw schedule error:', error);
        res.status(500).json({ error: error.message || 'Failed to process document' });
    }
});

/**
 * PUT /api/draw-schedules/:id
 * Update a draw schedule
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const {
            drawName, grandPrizeDate, ticketSalesStart, ticketSalesEnd,
            guaranteedPrize, prizeDescription, earlyBirds, pricing
        } = req.body;

        const updates = [];
        const values = [];
        let paramCount = 1;

        if (drawName !== undefined) { updates.push(`draw_name = $${paramCount++}`); values.push(drawName); }
        if (grandPrizeDate !== undefined) { updates.push(`grand_prize_date = $${paramCount++}`); values.push(grandPrizeDate); }
        if (ticketSalesStart !== undefined) { updates.push(`ticket_sales_start = $${paramCount++}`); values.push(ticketSalesStart); }
        if (ticketSalesEnd !== undefined) { updates.push(`ticket_sales_end = $${paramCount++}`); values.push(ticketSalesEnd); }
        if (guaranteedPrize !== undefined) { updates.push(`guaranteed_prize = $${paramCount++}`); values.push(guaranteedPrize); }
        if (prizeDescription !== undefined) { updates.push(`prize_description = $${paramCount++}`); values.push(prizeDescription); }
        if (earlyBirds !== undefined) { updates.push(`early_birds = $${paramCount++}`); values.push(JSON.stringify(earlyBirds)); }
        if (pricing !== undefined) { updates.push(`pricing = $${paramCount++}`); values.push(JSON.stringify(pricing)); }

        updates.push(`updated_by = $${paramCount++}`);
        values.push(req.userId);
        updates.push(`updated_at = NOW()`);

        values.push(id, organizationId);

        const result = await pool.query(
            `UPDATE draw_schedules SET ${updates.join(', ')}
             WHERE id = $${paramCount++} AND organization_id = $${paramCount}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Draw schedule not found' });
        }

        res.json({ schedule: result.rows[0] });

    } catch (error) {
        console.error('Update draw schedule error:', error);
        res.status(500).json({ error: 'Failed to update draw schedule' });
    }
});

/**
 * DELETE /api/draw-schedules/:id
 * Delete a draw schedule
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            'DELETE FROM draw_schedules WHERE id = $1 AND organization_id = $2 RETURNING id',
            [id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Draw schedule not found' });
        }

        res.json({ message: 'Draw schedule deleted' });

    } catch (error) {
        console.error('Delete draw schedule error:', error);
        res.status(500).json({ error: 'Failed to delete draw schedule' });
    }
});

module.exports = router;
