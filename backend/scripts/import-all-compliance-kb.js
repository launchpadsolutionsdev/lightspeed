#!/usr/bin/env node
/**
 * Import ALL Ontario compliance knowledge base entries from JSON files
 *
 * Usage:
 *   Option 1 (via API - server must be running):
 *     API_URL=http://localhost:3000 AUTH_TOKEN=<jwt_token> node scripts/import-all-compliance-kb.js
 *
 *   Option 2 (direct DB - requires DATABASE_URL):
 *     DATABASE_URL=<postgres_url> node scripts/import-all-compliance-kb.js --direct
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function getAllKBFiles() {
    return fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('-kb-entries.json'))
        .sort()
        .map(f => path.join(DATA_DIR, f));
}

async function importViaAPI() {
    const apiUrl = process.env.API_URL || 'http://localhost:3000';
    const token = process.env.AUTH_TOKEN;

    if (!token) {
        console.error('ERROR: AUTH_TOKEN environment variable is required for API import.');
        console.error('Get a JWT token by logging in as a super admin.');
        process.exit(1);
    }

    const files = getAllKBFiles();
    console.log(`Found ${files.length} KB entry files to import.\n`);

    let totalImported = 0;
    let totalErrors = 0;

    for (const file of files) {
        const filename = path.basename(file);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const entries = data.entries || data;
        console.log(`Importing ${filename} (${entries.length} entries)...`);

        const response = await fetch(`${apiUrl}/api/compliance/admin/entries/bulk-import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ entries })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`  API error (${response.status}): ${text}`);
            totalErrors += entries.length;
            continue;
        }

        const result = await response.json();
        console.log(`  Imported: ${result.imported}, Errors: ${result.errors}`);
        if (result.errors > 0) {
            result.error_details.forEach(e => console.error(`    - ${e.title}: ${e.error}`));
        }
        totalImported += result.imported;
        totalErrors += result.errors;
    }

    console.log(`\nDone. Total imported: ${totalImported}, Total errors: ${totalErrors}`);
}

async function importDirectDB() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL environment variable is required for direct DB import.');
        process.exit(1);
    }

    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false
    });

    const files = getAllKBFiles();
    console.log(`Found ${files.length} KB entry files to import.\n`);

    let totalImported = 0;
    let totalErrors = 0;

    // Clear existing entries to avoid duplicates on re-run
    const existingCount = await pool.query('SELECT COUNT(*) FROM compliance_knowledge_base');
    if (parseInt(existingCount.rows[0].count) > 0) {
        console.log(`Clearing ${existingCount.rows[0].count} existing entries before import...`);
        await pool.query('DELETE FROM compliance_knowledge_base');
    }

    for (const file of files) {
        const filename = path.basename(file);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const entries = data.entries || data;
        console.log(`Importing ${filename} (${entries.length} entries)...`);

        let fileImported = 0;
        let fileErrors = 0;

        for (const entry of entries) {
            try {
                const jurisResult = await pool.query(
                    'SELECT name, regulatory_body FROM compliance_jurisdictions WHERE code = $1',
                    [entry.jurisdiction_code]
                );
                if (jurisResult.rows.length === 0) {
                    console.error(`  SKIP: Unknown jurisdiction ${entry.jurisdiction_code} for "${entry.title}"`);
                    fileErrors++;
                    continue;
                }

                const { name: jurisdictionName, regulatory_body: regulatoryBody } = jurisResult.rows[0];
                const effectiveContent = entry.original_text || entry.content || '';

                await pool.query(
                    `INSERT INTO compliance_knowledge_base
                     (jurisdiction_code, jurisdiction_name, regulatory_body, category, title, content,
                      original_text, plain_summary,
                      source_name, source_url, source_section, last_verified_date, verified_by, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                    [
                        entry.jurisdiction_code, jurisdictionName, regulatoryBody,
                        entry.category, entry.title, effectiveContent,
                        entry.original_text || null, entry.plain_summary || null,
                        entry.source_name || null, entry.source_url || null, entry.source_section || null,
                        entry.last_verified_date || new Date().toISOString().split('T')[0],
                        'System', true
                    ]
                );
                fileImported++;
            } catch (err) {
                console.error(`  ERROR: "${entry.title}" - ${err.message}`);
                fileErrors++;
            }
        }

        console.log(`  OK: ${fileImported} imported, ${fileErrors} errors`);
        totalImported += fileImported;
        totalErrors += fileErrors;
    }

    // Update entry count for Ontario
    try {
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM compliance_knowledge_base WHERE jurisdiction_code = $1 AND is_active = true',
            ['ON']
        );
        await pool.query(
            'UPDATE compliance_jurisdictions SET entry_count = $1, updated_at = NOW() WHERE code = $2',
            [parseInt(countResult.rows[0].count), 'ON']
        );
        console.log(`\nUpdated Ontario entry count to ${countResult.rows[0].count}`);
    } catch (e) {
        console.warn('Warning: Could not update entry count:', e.message);
    }

    console.log(`\nDone. Total imported: ${totalImported}, Total errors: ${totalErrors}`);
    await pool.end();
}

// Main
(async () => {
    try {
        if (process.argv.includes('--direct')) {
            await importDirectDB();
        } else {
            await importViaAPI();
        }
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }
})();
