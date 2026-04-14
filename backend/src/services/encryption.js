/**
 * Authenticated symmetric encryption for sensitive column values.
 *
 * Uses AES-256-GCM with a random 12-byte IV per value and the built-in
 * 16-byte auth tag. Ciphertext is stored as a prefixed string so we
 * can identify encrypted vs. legacy-plaintext values and roll forward
 * without a big-bang migration.
 *
 * Storage format:
 *   enc:v1:<iv-base64>:<tag-base64>:<ciphertext-base64>
 *
 * Key source:
 *   ENCRYPTION_KEY env var — either base64- or hex-encoded 32 bytes.
 *   Generate: `openssl rand -base64 32`
 *
 * Backward compatibility:
 *   decrypt() returns the input unchanged when it lacks the enc:v1:
 *   prefix. Existing plaintext rows continue to work; they get
 *   upgraded to encrypted form the next time they're written.
 */

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const PREFIX = 'enc:v1:';

let _cachedKey = null;
let _cachedKeySource = null;

function loadKey() {
    const raw = process.env.ENCRYPTION_KEY;
    if (!raw) {
        throw new Error('ENCRYPTION_KEY is not set. Generate with: openssl rand -base64 32');
    }
    if (_cachedKey && _cachedKeySource === raw) return _cachedKey;

    // Try base64 first, then hex
    let buf = null;
    try {
        const candidate = Buffer.from(raw, 'base64');
        if (candidate.length === KEY_LENGTH) buf = candidate;
    } catch { /* try hex */ }
    if (!buf) {
        try {
            const candidate = Buffer.from(raw, 'hex');
            if (candidate.length === KEY_LENGTH) buf = candidate;
        } catch { /* fall through */ }
    }
    if (!buf) {
        throw new Error(`ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (base64 or hex)`);
    }

    _cachedKey = buf;
    _cachedKeySource = raw;
    return buf;
}

/**
 * Encrypt a plaintext string. Returns null for null/undefined input.
 * Throws if ENCRYPTION_KEY is missing or malformed.
 */
function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return null;
    const key = loadKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(String(plaintext), 'utf8'),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return PREFIX + [
        iv.toString('base64'),
        tag.toString('base64'),
        ciphertext.toString('base64')
    ].join(':');
}

/**
 * Decrypt a ciphertext string produced by encrypt(). If the input is
 * null, undefined, or doesn't carry the enc:v1: prefix, it's
 * returned as-is (supports legacy plaintext rows).
 */
function decrypt(value) {
    if (value === null || value === undefined) return value;
    const s = String(value);
    if (!s.startsWith(PREFIX)) return s; // legacy plaintext

    const parts = s.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
        throw new Error('Malformed ciphertext');
    }
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    if (iv.length !== IV_LENGTH) throw new Error('Invalid IV length');

    const key = loadKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * True if a stored value is in legacy plaintext form and should be
 * re-saved to migrate to ciphertext.
 */
function isLegacyPlaintext(value) {
    return value != null && !String(value).startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isLegacyPlaintext };
