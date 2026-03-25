/**
 * Data Retention Service
 *
 * Automatically cleans up old records based on per-organization retention
 * policies. Runs on a scheduled interval (daily) and deletes data older
 * than the configured retention period.
 *
 * Default retention periods (configurable per org):
 *   - response_history: 365 days
 *   - audit_logs: 730 days (2 years)
 *   - conversations: 180 days
 *   - usage_logs: 365 days
 */

const pool = require('../../config/database');
const log = require('./logger');

const DEFAULT_RETENTION = {
    response_history: 365,
    audit_logs: 730,
    conversations: 180,
    usage_logs: 365
};

const BATCH_SIZE = 500;

/**
 * Run retention cleanup for all organizations.
 * Processes each org's retention settings and deletes expired data in batches.
 */
async function runRetentionCleanup() {
    log.info('Data retention cleanup started');
    const startTime = Date.now();
    const stats = { orgs: 0, response_history: 0, audit_logs: 0, conversations: 0, usage_logs: 0 };

    try {
        const orgsResult = await pool.query(`
            SELECT id,
                   COALESCE(retention_response_history_days, $1) AS rh_days,
                   COALESCE(retention_audit_logs_days, $2) AS al_days,
                   COALESCE(retention_conversations_days, $3) AS cv_days,
                   COALESCE(retention_usage_logs_days, $4) AS ul_days
            FROM organizations
        `, [
            DEFAULT_RETENTION.response_history,
            DEFAULT_RETENTION.audit_logs,
            DEFAULT_RETENTION.conversations,
            DEFAULT_RETENTION.usage_logs
        ]);

        for (const org of orgsResult.rows) {
            try {
                const deleted = await cleanupOrg(org);
                stats.response_history += deleted.response_history;
                stats.audit_logs += deleted.audit_logs;
                stats.conversations += deleted.conversations;
                stats.usage_logs += deleted.usage_logs;
                stats.orgs++;
            } catch (orgErr) {
                log.error('Retention cleanup failed for org', { orgId: org.id, error: orgErr.message });
            }
        }

        const duration = Date.now() - startTime;
        log.info('Data retention cleanup complete', { ...stats, duration_ms: duration });
        return stats;
    } catch (error) {
        log.error('Data retention cleanup failed', { error: error.message });
        throw error;
    }
}

/**
 * Clean up expired data for a single organization.
 */
async function cleanupOrg(org) {
    const deleted = { response_history: 0, audit_logs: 0, conversations: 0, usage_logs: 0 };

    // Response history — delete in batches to avoid long locks
    deleted.response_history = await deleteExpiredBatched(
        `DELETE FROM response_history
         WHERE id IN (
             SELECT id FROM response_history
             WHERE organization_id = $1 AND created_at < NOW() - MAKE_INTERVAL(days := $2)
             LIMIT $3
         )`,
        org.id, org.rh_days
    );

    // Audit logs
    deleted.audit_logs = await deleteExpiredBatched(
        `DELETE FROM audit_logs
         WHERE id IN (
             SELECT id FROM audit_logs
             WHERE organization_id = $1 AND created_at < NOW() - MAKE_INTERVAL(days := $2)
             LIMIT $3
         )`,
        org.id, org.al_days
    );

    // Conversations
    deleted.conversations = await deleteExpiredBatched(
        `DELETE FROM conversations
         WHERE id IN (
             SELECT id FROM conversations
             WHERE organization_id = $1 AND created_at < NOW() - MAKE_INTERVAL(days := $2)
             LIMIT $3
         )`,
        org.id, org.cv_days
    );

    // Usage logs
    deleted.usage_logs = await deleteExpiredBatched(
        `DELETE FROM usage_logs
         WHERE id IN (
             SELECT id FROM usage_logs
             WHERE organization_id = $1 AND created_at < NOW() - MAKE_INTERVAL(days := $2)
             LIMIT $3
         )`,
        org.id, org.ul_days
    );

    return deleted;
}

/**
 * Delete expired records in batches to avoid long-running transactions.
 * Returns total number of rows deleted.
 */
async function deleteExpiredBatched(sql, orgId, retentionDays) {
    let totalDeleted = 0;
    let batchDeleted;

    do {
        const result = await pool.query(sql, [orgId, retentionDays, BATCH_SIZE]);
        batchDeleted = result.rowCount;
        totalDeleted += batchDeleted;
    } while (batchDeleted === BATCH_SIZE);

    return totalDeleted;
}

module.exports = { runRetentionCleanup, DEFAULT_RETENTION };
