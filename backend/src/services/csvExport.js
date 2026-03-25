/**
 * CSV Export Utility
 *
 * Converts arrays of objects to CSV format with proper escaping.
 * No external dependencies — uses RFC 4180 compliant quoting.
 */

/**
 * Escape a single CSV field value.
 * Wraps in double-quotes if the value contains commas, quotes, or newlines.
 */
function escapeField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Convert an array of objects to a CSV string.
 * @param {Object[]} rows - Array of flat objects
 * @param {string[]} columns - Column definitions: { key, header }
 * @returns {string} CSV string with BOM for Excel compatibility
 */
function toCSV(rows, columns) {
    const header = columns.map(c => escapeField(c.header)).join(',');
    const body = rows.map(row =>
        columns.map(c => escapeField(row[c.key])).join(',')
    ).join('\n');
    // UTF-8 BOM for proper Excel rendering of special characters
    return '\uFEFF' + header + '\n' + body;
}

module.exports = { toCSV, escapeField };
