/**
 * Tests for encryption helper (AES-256-GCM with prefix-tagged format).
 */

const { encrypt, decrypt, isLegacyPlaintext } = require('../../src/services/encryption');

describe('encryption', () => {
    const originalKey = process.env.ENCRYPTION_KEY;

    beforeEach(() => {
        // Fixed 32-byte key for deterministic tests (NOT for production use)
        process.env.ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
    });

    afterEach(() => {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
    });

    test('round-trips a string', () => {
        const ct = encrypt('shpat_sensitive_token');
        expect(ct).toMatch(/^enc:v1:/);
        expect(decrypt(ct)).toBe('shpat_sensitive_token');
    });

    test('produces a different ciphertext each call (random IV)', () => {
        const a = encrypt('same-plaintext');
        const b = encrypt('same-plaintext');
        expect(a).not.toBe(b);
        expect(decrypt(a)).toBe('same-plaintext');
        expect(decrypt(b)).toBe('same-plaintext');
    });

    test('handles empty string', () => {
        const ct = encrypt('');
        expect(decrypt(ct)).toBe('');
    });

    test('returns null / undefined unchanged', () => {
        expect(encrypt(null)).toBeNull();
        expect(encrypt(undefined)).toBeNull();
        expect(decrypt(null)).toBeNull();
        expect(decrypt(undefined)).toBeUndefined();
    });

    test('decrypt passes through legacy plaintext (no prefix)', () => {
        expect(decrypt('shpat_legacy_plaintext')).toBe('shpat_legacy_plaintext');
    });

    test('isLegacyPlaintext identifies un-prefixed values', () => {
        expect(isLegacyPlaintext('shpat_raw')).toBe(true);
        expect(isLegacyPlaintext('enc:v1:aaa:bbb:ccc')).toBe(false);
        expect(isLegacyPlaintext(null)).toBe(false);
        expect(isLegacyPlaintext(undefined)).toBe(false);
    });

    test('decrypt rejects tampered ciphertext', () => {
        const ct = encrypt('original');
        // Tamper with the last character of the ciphertext portion
        const tampered = ct.slice(0, -1) + (ct.slice(-1) === 'A' ? 'B' : 'A');
        expect(() => decrypt(tampered)).toThrow();
    });

    test('decrypt rejects malformed input', () => {
        expect(() => decrypt('enc:v1:not-enough-parts')).toThrow(/Malformed/);
    });

    test('encrypt throws if ENCRYPTION_KEY is missing', () => {
        delete process.env.ENCRYPTION_KEY;
        expect(() => encrypt('anything')).toThrow(/ENCRYPTION_KEY/);
    });

    test('encrypt throws if ENCRYPTION_KEY is wrong length', () => {
        process.env.ENCRYPTION_KEY = 'too-short';
        expect(() => encrypt('anything')).toThrow(/32 bytes/);
    });

    test('accepts hex-encoded key', () => {
        // 32 bytes as hex
        process.env.ENCRYPTION_KEY = '00'.repeat(32);
        const ct = encrypt('value');
        expect(decrypt(ct)).toBe('value');
    });

    test('different keys produce non-interoperable ciphertexts', () => {
        const ct = encrypt('secret');
        // Swap key
        process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
        expect(() => decrypt(ct)).toThrow();
    });
});
