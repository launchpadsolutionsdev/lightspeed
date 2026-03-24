/**
 * Organization Onboarding Service
 * Seeds starter content (templates, response rules) for newly created organizations.
 * This replaces the old TB-specific migration backfills with a generic,
 * multi-tenant onboarding flow that runs for every new org.
 */

const pool = require('../../config/database');
const log = require('./logger');

/**
 * Seed starter content for a newly created organization.
 * Copies system templates and inserts generic starter response rules.
 *
 * @param {string} orgId - The new organization's UUID
 * @param {string|null} userId - The creating user's UUID (for attribution), or null
 */
async function seedOrgStarterContent(orgId, userId) {
    try {
        // 1. Copy system templates to this org's template set
        await seedTemplates(orgId);

        // 2. Seed generic starter response rules
        await seedResponseRules(orgId, userId);

        log.info('Organization onboarding content seeded', { orgId });
    } catch (err) {
        // Non-fatal — org still works, just without starter content
        log.warn('Failed to seed org starter content', { orgId, error: err.message });
    }
}

/**
 * Copy all system-level templates (organization_id IS NULL) to the new org.
 */
async function seedTemplates(orgId) {
    const result = await pool.query(
        `INSERT INTO content_templates (organization_id, template_type, name, subject, headline, content, metadata, sort_order)
         SELECT $1, template_type, name, subject, headline, content, metadata, sort_order
         FROM content_templates
         WHERE organization_id IS NULL`,
        [orgId]
    );
    log.info('Seeded org templates from system library', { orgId, count: result.rowCount });
}

/**
 * Insert generic starter response rules that work for any lottery/raffle org.
 */
async function seedResponseRules(orgId, userId) {
    const starterRules = [
        {
            text: 'Never tell the customer to "feel free to reach out," "contact us at," or suggest emailing us — they are already emailing us and would simply reply to continue the conversation.',
            type: 'never',
            order: 1
        },
        {
            text: 'Start every email response with "Hi there," on the first line, followed by "Thank you for reaching out." on the next line.',
            type: 'always',
            order: 2
        }
    ];

    const values = [];
    const params = [];
    starterRules.forEach((rule, i) => {
        const offset = i * 5;
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
        params.push(orgId, rule.text, rule.type, rule.order, userId);
    });

    await pool.query(
        `INSERT INTO response_rules (organization_id, rule_text, rule_type, sort_order, created_by) VALUES ${values.join(', ')}`,
        params
    );
    log.info('Seeded org starter response rules', { orgId, count: starterRules.length });
}

module.exports = { seedOrgStarterContent };
