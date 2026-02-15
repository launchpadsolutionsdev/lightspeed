/**
 * Jurisdictions Routes
 * List jurisdictions & manage waitlist for upcoming jurisdictions
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/jurisdictions
 * List all jurisdictions, optionally filtered by country
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const { country } = req.query;
        let query = 'SELECT * FROM jurisdictions';
        const params = [];

        if (country) {
            query += ' WHERE country = $1';
            params.push(country.toUpperCase());
        }

        query += ' ORDER BY country, province_state_name';

        const result = await pool.query(query, params);
        res.json({ jurisdictions: result.rows });
    } catch (error) {
        console.error('Get jurisdictions error:', error);
        res.status(500).json({ error: 'Failed to get jurisdictions' });
    }
});

/**
 * GET /api/jurisdictions/:id
 * Get single jurisdiction
 */
router.get('/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM jurisdictions WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Jurisdiction not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get jurisdiction error:', error);
        res.status(500).json({ error: 'Failed to get jurisdiction' });
    }
});

/**
 * POST /api/jurisdictions/waitlist
 * Add current user's org to waitlist for a jurisdiction
 */
router.post('/waitlist', authenticate, async (req, res) => {
    try {
        const { jurisdiction_id } = req.body;

        if (!jurisdiction_id) {
            return res.status(400).json({ error: 'jurisdiction_id is required' });
        }

        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        // Verify jurisdiction exists
        const jResult = await pool.query('SELECT id, is_active FROM jurisdictions WHERE id = $1', [jurisdiction_id]);
        if (jResult.rows.length === 0) {
            return res.status(404).json({ error: 'Jurisdiction not found' });
        }

        if (jResult.rows[0].is_active) {
            return res.status(400).json({ error: 'This jurisdiction is already active' });
        }

        // Upsert into waitlist
        await pool.query(
            `INSERT INTO jurisdiction_waitlist (organization_id, jurisdiction_id)
             VALUES ($1, $2)
             ON CONFLICT (organization_id, jurisdiction_id) DO NOTHING`,
            [organizationId, jurisdiction_id]
        );

        res.json({ success: true, message: 'You will be notified when this jurisdiction becomes available.' });
    } catch (error) {
        console.error('Waitlist error:', error);
        res.status(500).json({ error: 'Failed to join waitlist' });
    }
});

module.exports = router;
