/**
 * Rules of Play Routes
 * CRUD for drafts, AI generation, reference upload, DOCX export
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate, checkUsageLimit } = require('../middleware/auth');
const claudeService = require('../services/claude');
const { buildSystemPrompt, RAFFLE_TYPE_LABELS } = require('../services/ropTemplates');
const multer = require('multer');
const mammoth = require('mammoth');

// Multer for reference document uploads (max 10MB, .docx and .pdf)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf'
        ];
        if (allowed.includes(file.mimetype) || file.originalname.endsWith('.docx') || file.originalname.endsWith('.pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Only .docx and .pdf files are supported'));
        }
    }
});

/** Helper: get user's organization_id */
async function getOrgId(userId) {
    const result = await pool.query(
        'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    return result.rows[0]?.organization_id || null;
}

/**
 * GET /api/rules-of-play
 * List all drafts for current user's organization
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(400).json({ error: 'No organization found' });

        const result = await pool.query(
            `SELECT d.id, d.name, d.raffle_type, d.status, d.created_at, d.updated_at,
                    j.province_state_name, j.country
             FROM rules_of_play_drafts d
             LEFT JOIN jurisdictions j ON d.jurisdiction_id = j.id
             WHERE d.organization_id = $1
             ORDER BY d.updated_at DESC`,
            [organizationId]
        );

        res.json({ drafts: result.rows });
    } catch (error) {
        console.error('List ROP drafts error:', error);
        res.status(500).json({ error: 'Failed to list drafts' });
    }
});

/**
 * POST /api/rules-of-play
 * Create a new draft
 */
router.post('/',
    authenticate,
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('raffle_type').isIn(['5050', 'catch_the_ace', 'prize_raffle', 'house_lottery']).withMessage('Invalid raffle type'),
    body('jurisdiction_id').optional().isUUID(),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const organizationId = await getOrgId(req.userId);
            if (!organizationId) return res.status(400).json({ error: 'No organization found' });

            const { name, raffle_type, jurisdiction_id, form_data } = req.body;

            const result = await pool.query(
                `INSERT INTO rules_of_play_drafts (organization_id, name, raffle_type, jurisdiction_id, form_data, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [organizationId, name, raffle_type, jurisdiction_id || null, JSON.stringify(form_data || {}), req.userId]
            );

            res.status(201).json(result.rows[0]);
        } catch (error) {
            console.error('Create ROP draft error:', error);
            res.status(500).json({ error: 'Failed to create draft' });
        }
    }
);

/**
 * GET /api/rules-of-play/:id
 * Get single draft (scoped to org)
 */
router.get('/:id', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(400).json({ error: 'No organization found' });

        const result = await pool.query(
            `SELECT d.*, j.province_state_name, j.country, j.minimum_age,
                    j.regulatory_body_name, j.regulatory_body_abbreviation,
                    j.responsible_gambling_org, j.responsible_gambling_phone,
                    j.geographic_restriction_text, j.unclaimed_prize_rule
             FROM rules_of_play_drafts d
             LEFT JOIN jurisdictions j ON d.jurisdiction_id = j.id
             WHERE d.id = $1 AND d.organization_id = $2`,
            [req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get ROP draft error:', error);
        res.status(500).json({ error: 'Failed to get draft' });
    }
});

/**
 * PUT /api/rules-of-play/:id
 * Update draft (save form data)
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(400).json({ error: 'No organization found' });

        const { name, form_data, generated_document, status } = req.body;

        const updates = [];
        const params = [];
        let paramIdx = 1;

        if (name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(name); }
        if (form_data !== undefined) { updates.push(`form_data = $${paramIdx++}`); params.push(JSON.stringify(form_data)); }
        if (generated_document !== undefined) { updates.push(`generated_document = $${paramIdx++}`); params.push(generated_document); }
        if (status !== undefined) { updates.push(`status = $${paramIdx++}`); params.push(status); }
        updates.push(`updated_at = NOW()`);

        if (updates.length === 1) return res.status(400).json({ error: 'No fields to update' });

        params.push(req.params.id, organizationId);

        const result = await pool.query(
            `UPDATE rules_of_play_drafts SET ${updates.join(', ')}
             WHERE id = $${paramIdx++} AND organization_id = $${paramIdx}
             RETURNING *`,
            params
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update ROP draft error:', error);
        res.status(500).json({ error: 'Failed to update draft' });
    }
});

/**
 * DELETE /api/rules-of-play/:id
 * Delete draft
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(400).json({ error: 'No organization found' });

        const result = await pool.query(
            'DELETE FROM rules_of_play_drafts WHERE id = $1 AND organization_id = $2 RETURNING id',
            [req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete ROP draft error:', error);
        res.status(500).json({ error: 'Failed to delete draft' });
    }
});

/**
 * POST /api/rules-of-play/:id/generate
 * Send form data to AI, save generated document. Counts against usage.
 */
router.post('/:id/generate', authenticate, checkUsageLimit, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(400).json({ error: 'No organization found' });

        // Fetch the draft with jurisdiction data
        const draftResult = await pool.query(
            `SELECT d.*, j.*,
                    d.id as draft_id, d.created_at as draft_created_at, d.updated_at as draft_updated_at
             FROM rules_of_play_drafts d
             LEFT JOIN jurisdictions j ON d.jurisdiction_id = j.id
             WHERE d.id = $1 AND d.organization_id = $2`,
            [req.params.id, organizationId]
        );

        if (draftResult.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });

        const draft = draftResult.rows[0];

        if (!draft.jurisdiction_id) {
            return res.status(400).json({ error: 'Please select a jurisdiction before generating' });
        }

        // Build the system prompt
        const systemPrompt = buildSystemPrompt({
            raffleType: draft.raffle_type,
            jurisdiction: {
                province_state_name: draft.province_state_name,
                country: draft.country,
                minimum_age: draft.minimum_age,
                regulatory_body_name: draft.regulatory_body_name,
                regulatory_body_abbreviation: draft.regulatory_body_abbreviation,
                responsible_gambling_org: draft.responsible_gambling_org,
                responsible_gambling_phone: draft.responsible_gambling_phone,
                geographic_restriction_text: draft.geographic_restriction_text,
                unclaimed_prize_rule: draft.unclaimed_prize_rule
            },
            formData: draft.form_data,
            referenceDocumentText: draft.reference_document_text
        });

        const userMessage = `Generate a complete Rules of Play document for this ${RAFFLE_TYPE_LABELS[draft.raffle_type] || draft.raffle_type} raffle. Use all the organization details and form data provided in the system context. Produce a professional, submission-ready document.`;

        // Call Claude API
        const startTime = Date.now();
        const response = await claudeService.generateResponse({
            messages: [{ role: 'user', content: userMessage }],
            system: systemPrompt,
            max_tokens: 8192
        });
        const responseTimeMs = Date.now() - startTime;

        // Extract text from response
        const generatedText = response.content?.[0]?.text || '';

        // Save to draft
        await pool.query(
            `UPDATE rules_of_play_drafts SET generated_document = $1, status = 'generated', updated_at = NOW()
             WHERE id = $2`,
            [generatedText, req.params.id]
        );

        // Log usage
        if (response.usage) {
            const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
            await pool.query(
                `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, response_time_ms, success, created_at)
                 VALUES (gen_random_uuid(), $1, $2, 'rules_of_play', $3, $4, TRUE, NOW())`,
                [organizationId, req.userId, totalTokens, responseTimeMs]
            );
        }

        res.json({ generated_document: generatedText, usage: response.usage });
    } catch (error) {
        console.error('Generate ROP error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate document' });
    }
});

/**
 * POST /api/rules-of-play/:id/upload-reference
 * Upload a reference document (.docx or .pdf), parse and save text
 */
router.post('/:id/upload-reference', authenticate, upload.single('file'), async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(400).json({ error: 'No organization found' });

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        let extractedText = '';

        if (req.file.originalname.endsWith('.docx') ||
            req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // Parse DOCX with Mammoth
            const result = await mammoth.extractRawText({ buffer: req.file.buffer });
            extractedText = result.value;
        } else if (req.file.originalname.endsWith('.pdf') || req.file.mimetype === 'application/pdf') {
            // Basic PDF text extraction — PDFs are binary, so we extract readable text
            // For a lightweight approach without adding a dependency, extract what we can
            const buffer = req.file.buffer;
            const text = buffer.toString('utf8');
            // Extract text between stream/endstream or readable ASCII sequences
            const matches = text.match(/[\x20-\x7E\n\r\t]{20,}/g);
            extractedText = matches ? matches.join('\n') : 'PDF text extraction was limited. Please upload a .docx file for better results.';
        }

        // Save to draft
        const result = await pool.query(
            `UPDATE rules_of_play_drafts SET reference_document_text = $1, updated_at = NOW()
             WHERE id = $2 AND organization_id = $3
             RETURNING id, reference_document_text`,
            [extractedText, req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });

        res.json({
            success: true,
            text_length: extractedText.length,
            preview: extractedText.substring(0, 500)
        });
    } catch (error) {
        console.error('Upload reference error:', error);
        res.status(500).json({ error: 'Failed to parse uploaded document' });
    }
});

/**
 * POST /api/rules-of-play/:id/export
 * Generate and return a .docx file
 */
router.post('/:id/export', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(400).json({ error: 'No organization found' });

        const result = await pool.query(
            `SELECT d.*, j.province_state_name
             FROM rules_of_play_drafts d
             LEFT JOIN jurisdictions j ON d.jurisdiction_id = j.id
             WHERE d.id = $1 AND d.organization_id = $2`,
            [req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });

        const draft = result.rows[0];

        if (!draft.generated_document) {
            return res.status(400).json({ error: 'No generated document to export. Please generate first.' });
        }

        // Build a simple HTML document and convert to DOCX via Mammoth's inverse isn't available
        // Instead, we'll generate a well-formatted HTML that can be opened in Word
        const orgName = draft.form_data?.organization_legal_name || 'Organization';
        const raffleName = draft.form_data?.raffle_brand_name || draft.name;
        const licenseNum = draft.form_data?.license_number || '';

        // Convert plain text to HTML paragraphs
        const htmlBody = draft.generated_document
            .split('\n')
            .map(line => {
                const trimmed = line.trim();
                if (!trimmed) return '';
                // Detect header-like lines (ALL CAPS or short lines ending with colon)
                if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 100) {
                    return `<h2 style="font-family: Calibri, sans-serif; font-size: 14pt; font-weight: bold; margin-top: 18pt; margin-bottom: 6pt;">${trimmed}</h2>`;
                }
                if (trimmed.endsWith(':') && trimmed.length < 80) {
                    return `<h3 style="font-family: Calibri, sans-serif; font-size: 12pt; font-weight: bold; margin-top: 12pt; margin-bottom: 4pt;">${trimmed}</h3>`;
                }
                if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
                    return `<li style="font-family: Calibri, sans-serif; font-size: 11pt; margin-left: 24pt;">${trimmed.substring(2)}</li>`;
                }
                return `<p style="font-family: Calibri, sans-serif; font-size: 11pt; margin-bottom: 6pt;">${trimmed}</p>`;
            })
            .join('\n');

        const htmlDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${raffleName} - Rules of Play</title>
</head>
<body style="font-family: Calibri, sans-serif; max-width: 7.5in; margin: 1in auto;">
<div style="text-align: center; margin-bottom: 24pt;">
    <h1 style="font-size: 16pt; margin-bottom: 6pt;">${orgName}</h1>
    <h2 style="font-size: 14pt; font-weight: normal; margin-bottom: 6pt;">${raffleName} — Rules of Play</h2>
    ${licenseNum ? `<p style="font-size: 11pt; color: #555;">License ${licenseNum}</p>` : ''}
</div>
${htmlBody}
</body>
</html>`;

        // Return as .doc (HTML format that Word opens natively)
        const filename = `${raffleName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_Rules_of_Play.doc`;

        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(htmlDoc);
    } catch (error) {
        console.error('Export ROP error:', error);
        res.status(500).json({ error: 'Failed to export document' });
    }
});

module.exports = router;
