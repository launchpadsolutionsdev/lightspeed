/**
 * Super-admin bootstrap.
 *
 * Reads a comma-separated list of emails from the SUPER_ADMINS
 * environment variable and ensures each one exists in the users table
 * with is_super_admin = true.
 *
 * Design choices:
 *   - Additive only. This service never REMOVES super_admin from users
 *     not in the list — demotion should be an explicit manual action.
 *   - Creates the user row if missing (placeholder email_verified so
 *     they can sign in via OAuth later).
 *   - No organization assignment. Super admin is a platform-operator
 *     flag distinct from org membership.
 *   - Safe to run on every startup.
 */

const pool = require('../../config/database');
const log = require('./logger');

function parseEmails(raw) {
    if (!raw) return [];
    return raw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0 && s.includes('@'));
}

async function ensureSuperAdmin(email) {
    // Upsert the user row. ON CONFLICT preserves existing first/last
    // name etc. while flipping the super-admin bit on.
    await pool.query(
        `INSERT INTO users (email, is_super_admin, email_verified, created_at)
         VALUES ($1, TRUE, TRUE, NOW())
         ON CONFLICT (email) DO UPDATE SET is_super_admin = TRUE`,
        [email]
    );
}

async function runSuperAdminBootstrap() {
    const emails = parseEmails(process.env.SUPER_ADMINS);
    if (emails.length === 0) return;

    for (const email of emails) {
        try {
            await ensureSuperAdmin(email);
            log.info('Super admin ensured', { email });
        } catch (err) {
            log.error('Super admin bootstrap error', { email, error: err.message });
        }
    }
}

module.exports = { runSuperAdminBootstrap, _parseEmails: parseEmails };
