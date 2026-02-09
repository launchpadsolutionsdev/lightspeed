/**
 * Organization Routes
 * Team management, invites, members
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate, requireOrganization, requireAdmin, requireOwner } = require('../middleware/auth');
const { sendInvitationEmail } = require('../services/email');

const FRONTEND_URL = 'https://www.lightspeedutility.ca';

/**
 * GET /api/organizations/my
 * Get current user's organization(s)
 */
router.get('/my', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT o.*, om.role,
                    (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = o.id) as member_count
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1`,
            [req.userId]
        );

        res.json({ organizations: result.rows });

    } catch (error) {
        console.error('Get organizations error:', error);
        res.status(500).json({ error: 'Failed to get organizations' });
    }
});

/**
 * GET /api/organizations/:orgId
 * Get organization details
 */
router.get('/:orgId', authenticate, requireOrganization, async (req, res) => {
    try {
        const memberCount = await pool.query(
            'SELECT COUNT(*) FROM organization_memberships WHERE organization_id = $1',
            [req.organization.id]
        );

        res.json({
            organization: {
                ...req.organization,
                role: req.memberRole,
                memberCount: parseInt(memberCount.rows[0].count)
            }
        });

    } catch (error) {
        console.error('Get organization error:', error);
        res.status(500).json({ error: 'Failed to get organization' });
    }
});

/**
 * PATCH /api/organizations/:orgId
 * Update organization settings
 */
router.patch('/:orgId', authenticate, requireOrganization, requireAdmin, [
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('brandVoice').optional(),
    body('timezone').optional(),
    body('websiteUrl').optional(),
    body('licenceNumber').optional(),
    body('storeLocation').optional(),
    body('supportEmail').optional(),
    body('ceoName').optional(),
    body('ceoTitle').optional(),
    body('mediaContactName').optional(),
    body('mediaContactEmail').optional(),
    body('ctaWebsiteUrl').optional(),
    body('mission').optional(),
    body('defaultDrawTime').optional(),
    body('ticketDeadlineTime').optional(),
    body('socialRequiredLine').optional(),
    body('brandTerminology').optional(),
    body('emailAddons').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const fieldMap = {
            name: 'name',
            brandVoice: 'brand_voice',
            timezone: 'timezone',
            websiteUrl: 'website_url',
            licenceNumber: 'licence_number',
            storeLocation: 'store_location',
            supportEmail: 'support_email',
            ceoName: 'ceo_name',
            ceoTitle: 'ceo_title',
            mediaContactName: 'media_contact_name',
            mediaContactEmail: 'media_contact_email',
            ctaWebsiteUrl: 'cta_website_url',
            mission: 'mission',
            defaultDrawTime: 'default_draw_time',
            ticketDeadlineTime: 'ticket_deadline_time',
            socialRequiredLine: 'social_required_line',
            brandTerminology: 'brand_terminology',
            emailAddons: 'email_addons'
        };

        const updates = [];
        const values = [];
        let paramCount = 1;

        for (const [bodyKey, dbColumn] of Object.entries(fieldMap)) {
            if (req.body[bodyKey] !== undefined) {
                updates.push(`${dbColumn} = $${paramCount++}`);
                values.push(req.body[bodyKey]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        values.push(req.organization.id);
        const result = await pool.query(
            `UPDATE organizations SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            values
        );

        res.json({ organization: result.rows[0] });

    } catch (error) {
        console.error('Update organization error:', error);
        res.status(500).json({ error: 'Failed to update organization' });
    }
});

/**
 * GET /api/organizations/:orgId/members
 * List members and pending invitations
 */
router.get('/:orgId/members', authenticate, requireOrganization, async (req, res) => {
    try {
        // Get members
        const membersResult = await pool.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.picture,
                    om.role, om.created_at as joined_at
             FROM users u
             JOIN organization_memberships om ON u.id = om.user_id
             WHERE om.organization_id = $1
             ORDER BY om.created_at`,
            [req.organization.id]
        );

        // Get pending invitations
        const invitesResult = await pool.query(
            `SELECT oi.id, oi.email, oi.role, oi.created_at, oi.expires_at,
                    u.first_name as invited_by_first_name, u.last_name as invited_by_last_name
             FROM organization_invitations oi
             LEFT JOIN users u ON oi.invited_by = u.id
             WHERE oi.organization_id = $1 AND oi.expires_at > NOW()
             ORDER BY oi.created_at DESC`,
            [req.organization.id]
        );

        res.json({
            members: membersResult.rows,
            invitations: invitesResult.rows
        });

    } catch (error) {
        console.error('Get members error:', error);
        res.status(500).json({ error: 'Failed to get members' });
    }
});

/**
 * POST /api/organizations/:orgId/invite
 * Send invitation to join organization
 */
router.post('/:orgId/invite', authenticate, requireOrganization, requireAdmin, [
    body('email').isEmail().withMessage('Valid email required'),
    body('role').isIn(['admin', 'member']).withMessage('Role must be admin or member')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, role } = req.body;

        // Check if user is already a member
        const existingMember = await pool.query(
            `SELECT u.id FROM users u
             JOIN organization_memberships om ON u.id = om.user_id
             WHERE u.email = $1 AND om.organization_id = $2`,
            [email, req.organization.id]
        );

        if (existingMember.rows.length > 0) {
            return res.status(400).json({ error: 'User is already a member' });
        }

        // Check for existing pending invitation
        const existingInvite = await pool.query(
            `SELECT id FROM organization_invitations
             WHERE email = $1 AND organization_id = $2 AND expires_at > NOW()`,
            [email, req.organization.id]
        );

        if (existingInvite.rows.length > 0) {
            return res.status(400).json({ error: 'Invitation already sent to this email' });
        }

        // Create invitation
        const inviteId = uuidv4();
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await pool.query(
            `INSERT INTO organization_invitations (id, organization_id, email, role, token, invited_by, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [inviteId, req.organization.id, email, role, token, req.userId, expiresAt]
        );

        // Generate invite link
        const inviteLink = `${FRONTEND_URL}?invite=${token}`;

        // Get inviter's name and org name for the email
        const inviterResult = await pool.query(
            'SELECT first_name, last_name FROM users WHERE id = $1',
            [req.userId]
        );
        const inviter = inviterResult.rows[0];
        const inviterName = `${inviter.first_name} ${inviter.last_name}`.trim() || 'A team member';

        const orgResult = await pool.query(
            'SELECT name FROM organizations WHERE id = $1',
            [req.organization.id]
        );
        const organizationName = orgResult.rows[0]?.name || 'your organization';

        // Send invitation email
        let emailSent = false;
        try {
            const emailResult = await sendInvitationEmail({
                to: email,
                inviterName,
                organizationName,
                inviteLink
            });
            emailSent = emailResult.success;
            if (!emailSent) {
                console.log('Email not sent (SMTP not configured), invite link returned for manual sharing');
            }
        } catch (emailError) {
            console.error('Failed to send invitation email:', emailError);
        }

        res.status(201).json({
            message: emailSent ? 'Invitation sent via email' : 'Invitation created - share the link manually',
            inviteLink,
            emailSent,
            invitation: {
                id: inviteId,
                email,
                role,
                expiresAt
            }
        });

    } catch (error) {
        console.error('Create invitation error:', error);
        res.status(500).json({ error: 'Failed to create invitation' });
    }
});

/**
 * POST /api/organizations/accept-invite
 * Accept invitation with token
 */
router.post('/accept-invite', authenticate, async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Invitation token required' });
        }

        // Find invitation
        const inviteResult = await pool.query(
            `SELECT oi.*, o.name as organization_name
             FROM organization_invitations oi
             JOIN organizations o ON oi.organization_id = o.id
             WHERE oi.token = $1 AND oi.expires_at > NOW()`,
            [token]
        );

        if (inviteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid or expired invitation' });
        }

        const invite = inviteResult.rows[0];

        // Check if user is already a member
        const existingMember = await pool.query(
            'SELECT id FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
            [req.userId, invite.organization_id]
        );

        if (existingMember.rows.length > 0) {
            // Delete the invitation since they're already a member
            await pool.query('DELETE FROM organization_invitations WHERE id = $1', [invite.id]);
            return res.status(400).json({ error: 'You are already a member of this organization' });
        }

        // Add user to organization
        await pool.query(
            `INSERT INTO organization_memberships (user_id, organization_id, role, invited_by, invited_at, accepted_at, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [req.userId, invite.organization_id, invite.role, invite.invited_by, invite.created_at]
        );

        // Delete the invitation
        await pool.query('DELETE FROM organization_invitations WHERE id = $1', [invite.id]);

        // Get the organization details
        const orgResult = await pool.query('SELECT * FROM organizations WHERE id = $1', [invite.organization_id]);

        res.json({
            message: 'Successfully joined organization',
            organization: {
                ...orgResult.rows[0],
                role: invite.role
            }
        });

    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});

/**
 * DELETE /api/organizations/:orgId/members/:memberId
 * Remove member from organization
 */
router.delete('/:orgId/members/:memberId', authenticate, requireOrganization, requireAdmin, async (req, res) => {
    try {
        const { memberId } = req.params;

        // Can't remove yourself
        if (memberId === req.userId) {
            return res.status(400).json({ error: 'Cannot remove yourself' });
        }

        // Check if target is owner (only owners can remove other owners)
        const targetMember = await pool.query(
            'SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
            [memberId, req.organization.id]
        );

        if (targetMember.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        if (targetMember.rows[0].role === 'owner' && req.memberRole !== 'owner') {
            return res.status(403).json({ error: 'Only owners can remove other owners' });
        }

        // Remove member
        await pool.query(
            'DELETE FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
            [memberId, req.organization.id]
        );

        res.json({ message: 'Member removed' });

    } catch (error) {
        console.error('Remove member error:', error);
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

/**
 * PATCH /api/organizations/:orgId/members/:memberId
 * Update member role
 */
router.patch('/:orgId/members/:memberId', authenticate, requireOrganization, requireOwner, [
    body('role').isIn(['owner', 'admin', 'member']).withMessage('Invalid role')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { memberId } = req.params;
        const { role } = req.body;

        // Can't change your own role
        if (memberId === req.userId) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }

        // Check if member exists
        const memberResult = await pool.query(
            'SELECT * FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
            [memberId, req.organization.id]
        );

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Update role
        await pool.query(
            'UPDATE organization_memberships SET role = $1 WHERE user_id = $2 AND organization_id = $3',
            [role, memberId, req.organization.id]
        );

        res.json({ message: 'Role updated' });

    } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

/**
 * DELETE /api/organizations/:orgId/invitations/:id
 * Cancel pending invitation
 */
router.delete('/:orgId/invitations/:id', authenticate, requireOrganization, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM organization_invitations WHERE id = $1 AND organization_id = $2 RETURNING id',
            [id, req.organization.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        res.json({ message: 'Invitation cancelled' });

    } catch (error) {
        console.error('Cancel invitation error:', error);
        res.status(500).json({ error: 'Failed to cancel invitation' });
    }
});

module.exports = router;
