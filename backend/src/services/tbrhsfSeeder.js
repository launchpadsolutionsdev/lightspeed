/**
 * TBRHSF (Thunder Bay Regional Health Sciences Foundation) seeder.
 *
 * Loads organization-specific profile fields, content configuration,
 * and knowledge base entries from backend/data/tbrhsf-seed.json into
 * the TBRHSF organization row.
 *
 * Gated by the SEED_TBRHSF environment variable. The generalized
 * product (what gets handed to the acquirer for resale to other
 * charities) ships without this seed running — setting the env flag
 * is the only way to load it.
 *
 * Idempotent: safe to run on every startup. Profile and config UPDATE
 * is unconditional (it just writes the same values back); KB inserts
 * are gated by a marker in `_migration_flags`.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../../config/database');
const log = require('./logger');

const SEED_FLAG_KEY = 'tbrhsf_seed_kb_runtime';
const SEED_FILE = path.join(__dirname, '..', '..', 'data', 'tbrhsf-seed.json');

async function findOrganizationId(namePattern) {
    const result = await pool.query(
        'SELECT id FROM organizations WHERE name ILIKE $1 LIMIT 1',
        [namePattern]
    );
    return result.rows[0]?.id || null;
}

async function applyProfile(orgId, profile) {
    const fields = Object.keys(profile);
    if (fields.length === 0) return;
    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
    const values = [orgId, ...fields.map(f => profile[f])];
    await pool.query(
        `UPDATE organizations SET ${setClauses.join(', ')} WHERE id = $1`,
        values
    );
}

async function applyContentConfig(orgId, contentConfig) {
    const fields = Object.keys(contentConfig);
    if (fields.length === 0) return;
    // JSONB columns need JSON.stringify; primitives pass through.
    const values = [orgId, ...fields.map(f => {
        const v = contentConfig[f];
        return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
    })];
    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
    await pool.query(
        `UPDATE organizations SET ${setClauses.join(', ')} WHERE id = $1`,
        values
    );
}

async function alreadySeeded() {
    try {
        const result = await pool.query(
            'SELECT 1 FROM _migration_flags WHERE key = $1',
            [SEED_FLAG_KEY]
        );
        return result.rows.length > 0;
    } catch {
        return false;
    }
}

async function markSeeded() {
    await pool.query(
        'INSERT INTO _migration_flags (key, applied_at) VALUES ($1, NOW()) ON CONFLICT (key) DO NOTHING',
        [SEED_FLAG_KEY]
    );
}

async function seedKnowledgeBase(orgId, entries) {
    for (const entry of entries) {
        await pool.query(
            `INSERT INTO knowledge_base (organization_id, title, content, category, tags)
             VALUES ($1, $2, $3, $4, $5)`,
            [orgId, entry.title, entry.content, entry.category || 'general', entry.tags || []]
        );
    }
}

/**
 * Run the TBRHSF seeder. No-ops unless SEED_TBRHSF=true is set.
 * Called once at startup after migrations complete.
 */
async function runTbrhsfSeeder() {
    if (process.env.SEED_TBRHSF !== 'true') return;

    if (!fs.existsSync(SEED_FILE)) {
        log.warn('SEED_TBRHSF=true but seed file missing', { path: SEED_FILE });
        return;
    }

    let seed;
    try {
        seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    } catch (err) {
        log.error('Failed to parse TBRHSF seed file', { error: err.message });
        return;
    }

    try {
        const orgId = await findOrganizationId(seed.organizationNamePattern);
        if (!orgId) {
            log.info('TBRHSF seeder: target organization not found — skipping');
            return;
        }

        // Profile and content config are cheap to rewrite on every
        // startup and mirror the JSON as the source of truth.
        if (seed.profile) await applyProfile(orgId, seed.profile);
        if (seed.contentConfig) await applyContentConfig(orgId, seed.contentConfig);

        // KB entries only insert once (duplicates would grow on every boot).
        if (Array.isArray(seed.knowledgeBase) && seed.knowledgeBase.length > 0) {
            if (await alreadySeeded()) {
                log.debug('TBRHSF seeder: KB already seeded — skipping inserts');
            } else {
                await seedKnowledgeBase(orgId, seed.knowledgeBase);
                await markSeeded();
                log.info('TBRHSF seeder: KB seeded', { entries: seed.knowledgeBase.length });
            }
        }

        log.info('TBRHSF seeder: profile and content config applied', { orgId });
    } catch (err) {
        log.error('TBRHSF seeder error', { error: err.message });
    }
}

module.exports = { runTbrhsfSeeder };
