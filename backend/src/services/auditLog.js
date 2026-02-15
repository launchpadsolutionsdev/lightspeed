/**
 * Audit Log Service
 * Fire-and-forget logging of sensitive operations
 */

const pool = require('../../config/database');

/**
 * Log a sensitive action to the audit_logs table.
 * This is fire-and-forget — it never blocks the main request.
 *
 * @param {Object} options
 * @param {string} [options.orgId] - Organization ID (null for system-level actions)
 * @param {string} [options.userId] - Actor user ID
 * @param {string} options.action - Action name (e.g. 'MEMBER_INVITED', 'KB_ENTRY_DELETED')
 * @param {string} options.resourceType - Resource type ('USER', 'ORGANIZATION', 'KNOWLEDGE_BASE', etc.)
 * @param {string} [options.resourceId] - ID of the affected resource
 * @param {Object} [options.changes] - Before/after values or relevant context
 * @param {Object} [options.req] - Express request object (for IP extraction)
 */
function logAction({ orgId, userId, action, resourceType, resourceId, changes, req }) {
    const ip = req ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null) : null;

    pool.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, changes, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orgId || null, userId || null, action, resourceType, resourceId || null, changes ? JSON.stringify(changes) : null, ip]
    ).catch(err => {
        console.error('[AUDIT] Failed to write audit log:', err.message);
    });
}

module.exports = { logAction };
