/**
 * URL validation for server-side fetches.
 *
 * Guards against SSRF by rejecting non-HTTP(S) protocols and hostnames that
 * resolve to private / loopback / link-local / cloud metadata addresses.
 *
 * Not a complete defense on its own — a motivated attacker can bypass DNS
 * checks via DNS rebinding (TTL=0, return different IP on the second
 * lookup). For fuller protection, combine with (a) using the resolved IP
 * in the outbound request with the original Host header, or (b) running
 * outbound fetches through an egress proxy with its own allow-list.
 */

const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;                       // RFC1918
    if (a === 127) return true;                      // loopback
    if (a === 0) return true;                        // "this network"
    if (a === 169 && b === 254) return true;         // link-local (incl. AWS/GCP metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;         // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 CGNAT
    if (a >= 224) return true;                       // multicast + reserved
    return false;
}

function isPrivateIPv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('fe80')) return true;                          // link-local
    if (lower.startsWith('::ffff:')) {
        // IPv4-mapped IPv6 — validate the v4 portion
        return isPrivateIPv4(lower.slice(7));
    }
    return false;
}

function isPrivateAddress(ip) {
    if (net.isIPv4(ip)) return isPrivateIPv4(ip);
    if (net.isIPv6(ip)) return isPrivateIPv6(ip);
    return true; // unknown family — treat as unsafe
}

const BLOCKED_HOSTNAME_LITERALS = new Set([
    'localhost',
    'metadata',
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
]);

/**
 * Validate that a URL is safe to fetch from the server.
 * Throws an Error with a human-readable message on rejection.
 *
 * @param {string} urlString
 * @param {object} [options]
 * @param {boolean} [options.requireHttps=false] - if true, rejects http://
 */
async function assertSafeHttpUrl(urlString, options = {}) {
    const { requireHttps = false } = options;

    if (typeof urlString !== 'string' || !urlString.trim()) {
        throw new Error('URL is required');
    }

    let url;
    try {
        url = new URL(urlString);
    } catch {
        throw new Error('URL is malformed');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('URL must use http or https');
    }
    if (requireHttps && url.protocol !== 'https:') {
        throw new Error('URL must use https');
    }

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    if (!hostname) {
        throw new Error('URL has no host');
    }
    if (BLOCKED_HOSTNAME_LITERALS.has(hostname)) {
        throw new Error('URL host is not permitted');
    }
    if (hostname.endsWith('.localhost')) {
        throw new Error('URL host is not permitted');
    }

    // If the hostname itself is a literal IP, check it directly.
    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            throw new Error('URL host resolves to a non-public address');
        }
        return;
    }

    // Otherwise resolve and reject if any resolution is private.
    let addrs;
    try {
        addrs = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new Error('URL host could not be resolved');
    }
    if (!addrs.length) {
        throw new Error('URL host could not be resolved');
    }
    for (const addr of addrs) {
        if (isPrivateAddress(addr.address)) {
            throw new Error('URL host resolves to a non-public address');
        }
    }
}

module.exports = {
    assertSafeHttpUrl,
    // Exported for unit tests
    _isPrivateAddress: isPrivateAddress
};
