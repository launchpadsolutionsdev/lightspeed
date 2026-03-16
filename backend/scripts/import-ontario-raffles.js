#!/usr/bin/env node
/**
 * Import Ontario Raffles knowledge base entries
 *
 * Usage:
 *   Option 1 (via API - server must be running):
 *     API_URL=http://localhost:3000 AUTH_TOKEN=<jwt_token> node scripts/import-ontario-raffles.js
 *
 *   Option 2 (direct DB - requires DATABASE_URL):
 *     DATABASE_URL=<postgres_url> node scripts/import-ontario-raffles.js --direct
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'ontario-raffles-kb-entries.json');

async function importViaAPI() {
    const apiUrl = process.env.API_URL || 'http://localhost:3000';
    const token = process.env.AUTH_TOKEN;

    if (!token) {
        console.error('ERROR: AUTH_TOKEN environment variable is required for API import.');
        console.error('Get a JWT token by logging in as a super admin.');
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`Importing ${data.entries.length} entries via API...`);

    const response = await fetch(`${apiUrl}/api/compliance/admin/entries/bulk-import`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`API error (${response.status}):`, text);
        process.exit(1);
    }

    const result = await response.json();
    console.log(`Successfully imported: ${result.imported} entries`);
    if (result.errors > 0) {
        console.error(`Errors: ${result.errors}`);
        console.error('Error details:', JSON.stringify(result.error_details, null, 2));
    }
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

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`Importing ${data.entries.length} entries directly to database...`);

    let imported = 0;
    let errors = 0;

    for (const entry of data.entries) {
        try {
            const jurisResult = await pool.query(
                'SELECT name, regulatory_body FROM compliance_jurisdictions WHERE code = $1',
                [entry.jurisdiction_code]
            );
            if (jurisResult.rows.length === 0) {
                console.error(`  SKIP: Unknown jurisdiction ${entry.jurisdiction_code} for "${entry.title}"`);
                errors++;
                continue;
            }

            const { name: jurisdictionName, regulatory_body: regulatoryBody } = jurisResult.rows[0];
            const effectiveContent = entry.original_text || entry.content;

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
            imported++;
            console.log(`  OK: ${entry.title}`);
        } catch (err) {
            console.error(`  ERROR: "${entry.title}" - ${err.message}`);
            errors++;
        }
    }

    // Update entry count
    try {
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM compliance_knowledge_base WHERE jurisdiction_code = $1 AND is_active = true',
            ['ON']
        );
        await pool.query(
            'UPDATE compliance_jurisdictions SET entry_count = $1, updated_at = NOW() WHERE code = $2',
            [parseInt(countResult.rows[0].count), 'ON']
        );
    } catch (e) {
        console.warn('Warning: Could not update entry count:', e.message);
    }

    console.log(`\nDone. Imported: ${imported}, Errors: ${errors}`);
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
