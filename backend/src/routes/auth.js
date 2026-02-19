/**
 * Authentication Routes
 * Google OAuth + Microsoft OAuth
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { OAuth2Client } = require('google-auth-library');
const msal = require('@azure/msal-node');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Microsoft MSAL Confidential Client configuration
const msalConfig = {
    auth: {
        clientId: process.env.MICROSOFT_CLIENT_ID || '',
        authority: 'https://login.microsoftonline.com/common',
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || ''
    }
};
const msalClient = new msal.ConfidentialClientApplication(msalConfig);

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
        const { credential, accessToken } = req.body;

        let userEmail, userName, userGoogleId, userPicture;

        if (credential) {
            // Primary flow: verify the Google JWT credential (from One Tap / popup)
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
        } else if (accessToken) {
            // Fallback flow: verify access token via Google's userinfo API
            try {
                const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                if (!userinfoResponse.ok) {
                    return res.status(401).json({ error: 'Invalid Google access token' });
                }
                const profile = await userinfoResponse.json();
                userEmail = profile.email;
                userName = profile.name || profile.given_name || '';
                userGoogleId = profile.sub;
                userPicture = profile.picture || null;
            } catch (fetchError) {
                console.error('Google userinfo API call failed:', fetchError);
                return res.status(401).json({ error: 'Failed to verify Google access token' });
            }
        } else {
            return res.status(401).json({ error: 'Google credential or access token is required' });
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
        const organization = orgResult.rows[0] || null;
        const needsOrganization = !organization;

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
            organization,
            isNewUser,
            needsOrganization
        });

    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

/**
 * POST /api/auth/microsoft
 * Microsoft OAuth login/signup
 * Receives an authorization code from the frontend MSAL popup flow,
 * exchanges it for tokens, fetches user profile, and creates/updates the user.
 */
router.post('/microsoft', async (req, res) => {
    try {
        const { code, redirectUri, accessToken, email, name, microsoftId } = req.body;

        let userEmail, userName, userMicrosoftId, userPicture = null;

        if (accessToken) {
            // Token-based flow: frontend already has an access token from MSAL popup.
            // Verify it by calling Microsoft Graph to get the user profile.
            try {
                const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                if (!graphResponse.ok) {
                    return res.status(401).json({ error: 'Invalid Microsoft access token' });
                }
                const profile = await graphResponse.json();
                userEmail = profile.mail || profile.userPrincipalName || email;
                userName = profile.displayName || name || '';
                userMicrosoftId = profile.id || microsoftId;
            } catch (graphError) {
                console.error('Microsoft Graph API call failed:', graphError);
                return res.status(401).json({ error: 'Failed to verify Microsoft access token' });
            }

            // Fetch profile picture (optional, best-effort)
            try {
                const photoResponse = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                if (photoResponse.ok) {
                    const arrayBuffer = await photoResponse.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    const contentType = photoResponse.headers.get('content-type') || 'image/jpeg';
                    userPicture = `data:${contentType};base64,${base64}`;
                }
            } catch (photoError) {
                // Profile photo is optional
            }
        } else if (code && redirectUri) {
            // Authorization code flow: exchange the code for tokens
            let tokenResponse;
            try {
                tokenResponse = await msalClient.acquireTokenByCode({
                    code,
                    scopes: ['openid', 'profile', 'email', 'User.Read'],
                    redirectUri
                });
            } catch (msalError) {
                console.error('MSAL token exchange failed:', msalError);
                return res.status(401).json({ error: 'Invalid Microsoft authorization code' });
            }

            const account = tokenResponse.account;
            userEmail = account.username || tokenResponse.idTokenClaims?.email || tokenResponse.idTokenClaims?.preferred_username;
            userName = account.name || tokenResponse.idTokenClaims?.name || '';
            userMicrosoftId = account.homeAccountId || tokenResponse.idTokenClaims?.oid || tokenResponse.idTokenClaims?.sub;

            // Fetch profile picture (optional, best-effort)
            try {
                const photoResponse = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
                    headers: { Authorization: `Bearer ${tokenResponse.accessToken}` }
                });
                if (photoResponse.ok) {
                    const arrayBuffer = await photoResponse.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    const contentType = photoResponse.headers.get('content-type') || 'image/jpeg';
                    userPicture = `data:${contentType};base64,${base64}`;
                }
            } catch (photoError) {
                // Profile photo is optional
            }
        } else {
            return res.status(400).json({ error: 'Access token or authorization code is required' });
        }

        if (!userEmail) {
            return res.status(400).json({ error: 'Could not retrieve email from Microsoft account' });
        }

        // Check if user exists (by email or microsoft_id)
        let userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 OR microsoft_id = $2',
            [userEmail, userMicrosoftId]
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
                `INSERT INTO users (id, email, first_name, last_name, picture, microsoft_id, email_verified, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
                 RETURNING *`,
                [userId, userEmail, firstName, lastName, userPicture, userMicrosoftId]
            );
            user = insertResult.rows[0];
            isNewUser = true;

            // Check for pending invitations
            const inviteResult = await pool.query(
                'SELECT * FROM organization_invitations WHERE email = $1 AND expires_at > NOW()',
                [userEmail]
            );

            if (inviteResult.rows.length > 0) {
                const invite = inviteResult.rows[0];
                await pool.query(
                    `INSERT INTO organization_memberships (user_id, organization_id, role, invited_by, invited_at, accepted_at, created_at)
                     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
                    [userId, invite.organization_id, invite.role, invite.invited_by, invite.created_at]
                );
                await pool.query('DELETE FROM organization_invitations WHERE id = $1', [invite.id]);
            }
        } else {
            // Update existing user
            user = userResult.rows[0];
            await pool.query(
                `UPDATE users SET picture = COALESCE($1, picture), microsoft_id = COALESCE($2, microsoft_id), last_login_at = NOW() WHERE id = $3`,
                [userPicture, userMicrosoftId, user.id]
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
        const organization = orgResult.rows[0] || null;
        const needsOrganization = !organization;

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
            organization,
            isNewUser,
            needsOrganization
        });

    } catch (error) {
        console.error('Microsoft auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
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

        const organization = orgResult.rows[0] || null;
        res.json({
            user: {
                id: req.user.id,
                email: req.user.email,
                firstName: req.user.first_name,
                lastName: req.user.last_name,
                picture: req.user.picture,
                isSuperAdmin: req.user.is_super_admin
            },
            organization,
            needsOrganization: !organization
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

module.exports = router;
