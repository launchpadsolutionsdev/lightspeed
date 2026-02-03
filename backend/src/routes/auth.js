/**
 * Authentication Routes
 * Google OAuth, login, registration, password reset
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
    return jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

/**
 * POST /api/auth/google
 * Google OAuth login/signup
 */
router.post('/google', async (req, res) => {
    try {
        const { credential, email, name, googleId, picture } = req.body;

        let userEmail, userName, userGoogleId, userPicture;

        // Verify Google credential if provided
        if (credential) {
            try {
                const ticket = await googleClient.verifyIdToken({
                    idToken: credential,
                    audience: process.env.GOOGLE_CLIENT_ID
                });
                const payload = ticket.getPayload();
                userEmail = payload.email;
                userName = payload.name;
                userGoogleId = payload.sub;
                userPicture = payload.picture;
            } catch (verifyError) {
                console.error('Google token verification failed:', verifyError);
                return res.status(401).json({ error: 'Invalid Google credential' });
            }
        } else if (email && googleId) {
            // Fallback: use provided user info
            userEmail = email;
            userName = name || '';
            userGoogleId = googleId;
            userPicture = picture || '';
        } else {
            return res.status(400).json({ error: 'Credential or email required' });
        }

        // Check if user exists
        let userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 OR google_id = $2',
            [userEmail, userGoogleId]
        );

        let user;
        let isNewUser = false;

        if (userResult.rows.length === 0) {
            // Create new user
            const userId = uuidv4();
            const nameParts = userName.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            const insertResult = await pool.query(
                `INSERT INTO users (id, email, first_name, last_name, picture, google_id, email_verified, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
                 RETURNING *`,
                [userId, userEmail, firstName, lastName, userPicture, userGoogleId]
            );
            user = insertResult.rows[0];
            isNewUser = true;

            // Check for pending invitations
            const inviteResult = await pool.query(
                'SELECT * FROM organization_invitations WHERE email = $1 AND expires_at > NOW()',
                [userEmail]
            );

            if (inviteResult.rows.length > 0) {
                // Auto-join the organization from the invitation
                const invite = inviteResult.rows[0];
                await pool.query(
                    `INSERT INTO organization_memberships (user_id, organization_id, role, invited_by, invited_at, accepted_at, created_at)
                     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
                    [userId, invite.organization_id, invite.role, invite.invited_by, invite.created_at]
                );

                // Delete the invitation
                await pool.query('DELETE FROM organization_invitations WHERE id = $1', [invite.id]);
            }
        } else {
            // Update existing user
            user = userResult.rows[0];
            await pool.query(
                `UPDATE users SET picture = COALESCE($1, picture), google_id = COALESCE($2, google_id), last_login_at = NOW() WHERE id = $3`,
                [userPicture, userGoogleId, user.id]
            );
        }

        // Get user's organization
        const orgResult = await pool.query(
            `SELECT o.*, om.role
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1
             LIMIT 1`,
            [user.id]
        );

        const token = generateToken(user.id);

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                picture: user.picture,
                isSuperAdmin: user.is_super_admin
            },
            organization: orgResult.rows[0] || null,
            isNewUser
        });

    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

/**
 * POST /api/auth/register
 * Email/password registration
 */
router.post('/register', [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').notEmpty().withMessage('First name required'),
    body('lastName').notEmpty().withMessage('Last name required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password, firstName, lastName } = req.body;

        // Check if user exists
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const userId = uuidv4();
        const result = await pool.query(
            `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING id, email, first_name, last_name`,
            [userId, email, passwordHash, firstName, lastName]
        );

        const user = result.rows[0];
        const token = generateToken(user.id);

        res.status(201).json({
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name
            },
            isNewUser: true
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

/**
 * POST /api/auth/login
 * Email/password login
 */
router.post('/login', [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Get user
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Check if user has a password (might be Google-only)
        if (!user.password_hash) {
            return res.status(401).json({ error: 'Please sign in with Google' });
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Update last login
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        // Get organization
        const orgResult = await pool.query(
            `SELECT o.*, om.role
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1
             LIMIT 1`,
            [user.id]
        );

        const token = generateToken(user.id);

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                picture: user.picture,
                isSuperAdmin: user.is_super_admin
            },
            organization: orgResult.rows[0] || null
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

/**
 * GET /api/auth/me
 * Get current user + organization
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            `SELECT o.*, om.role
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1
             LIMIT 1`,
            [req.userId]
        );

        res.json({
            user: {
                id: req.user.id,
                email: req.user.email,
                firstName: req.user.first_name,
                lastName: req.user.last_name,
                picture: req.user.picture,
                isSuperAdmin: req.user.is_super_admin
            },
            organization: orgResult.rows[0] || null
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

/**
 * POST /api/auth/create-organization
 * Create organization for new user
 */
router.post('/create-organization', authenticate, [
    body('name').notEmpty().withMessage('Organization name required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name } = req.body;

        // Check if user already has an organization
        const existingOrg = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1',
            [req.userId]
        );

        if (existingOrg.rows.length > 0) {
            return res.status(400).json({ error: 'User already belongs to an organization' });
        }

        // Create organization
        const orgId = uuidv4();
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const trialDays = parseInt(process.env.TRIAL_DAYS) || 14;
        const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO organizations (id, name, slug, subscription_status, trial_ends_at, created_at)
             VALUES ($1, $2, $3, 'trial', $4, NOW())`,
            [orgId, name, slug, trialEndsAt]
        );

        // Add user as owner
        await pool.query(
            `INSERT INTO organization_memberships (user_id, organization_id, role, created_at)
             VALUES ($1, $2, 'owner', NOW())`,
            [req.userId, orgId]
        );

        // Get the created organization
        const orgResult = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);

        res.status(201).json({
            organization: {
                ...orgResult.rows[0],
                role: 'owner'
            }
        });

    } catch (error) {
        console.error('Create org error:', error);
        res.status(500).json({ error: 'Failed to create organization' });
    }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password', [
    body('email').isEmail().withMessage('Valid email required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email } = req.body;

        // Check if user exists
        const result = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            // Don't reveal if email exists
            return res.json({ message: 'If your email is registered, you will receive a reset link' });
        }

        const user = result.rows[0];

        // Google-only users can't reset password
        if (!user.password_hash) {
            return res.json({ message: 'If your email is registered, you will receive a reset link' });
        }

        // Generate reset token (in production, store this and send via email)
        const resetToken = uuidv4();
        // TODO: Store token in database with expiry
        // TODO: Send email with reset link

        res.json({ message: 'If your email is registered, you will receive a reset link' });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', [
    body('token').notEmpty().withMessage('Reset token required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // TODO: Implement token verification and password reset
        res.status(501).json({ error: 'Password reset not yet implemented' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

/**
 * POST /api/auth/change-password
 * Change password (logged in user)
 */
router.post('/change-password', authenticate, [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { currentPassword, newPassword } = req.body;

        // Get user with password
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
        const user = result.rows[0];

        if (!user.password_hash) {
            return res.status(400).json({ error: 'Cannot change password for Google-only account' });
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash and update new password
        const newHash = await bcrypt.hash(newPassword, 12);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.userId]);

        res.json({ message: 'Password changed successfully' });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

module.exports = router;
