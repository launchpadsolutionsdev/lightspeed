/**
 * Tests for urlValidator — SSRF guard for server-side URL fetches.
 */

const { assertSafeHttpUrl, _isPrivateAddress } = require('../../src/services/urlValidator');

describe('_isPrivateAddress', () => {
    test('blocks IPv4 private ranges', () => {
        expect(_isPrivateAddress('10.0.0.1')).toBe(true);
        expect(_isPrivateAddress('172.16.5.1')).toBe(true);
        expect(_isPrivateAddress('172.31.255.255')).toBe(true);
        expect(_isPrivateAddress('192.168.1.1')).toBe(true);
    });

    test('blocks IPv4 loopback and link-local', () => {
        expect(_isPrivateAddress('127.0.0.1')).toBe(true);
        expect(_isPrivateAddress('169.254.169.254')).toBe(true); // AWS/GCP metadata
        expect(_isPrivateAddress('0.0.0.0')).toBe(true);
    });

    test('blocks IPv4 CGNAT', () => {
        expect(_isPrivateAddress('100.64.0.1')).toBe(true);
        expect(_isPrivateAddress('100.127.255.255')).toBe(true);
    });

    test('blocks IPv4 multicast', () => {
        expect(_isPrivateAddress('224.0.0.1')).toBe(true);
        expect(_isPrivateAddress('255.255.255.255')).toBe(true);
    });

    test('allows public IPv4', () => {
        expect(_isPrivateAddress('8.8.8.8')).toBe(false);
        expect(_isPrivateAddress('1.1.1.1')).toBe(false);
        expect(_isPrivateAddress('173.194.0.1')).toBe(false);
    });

    test('blocks IPv6 loopback / ULA / link-local', () => {
        expect(_isPrivateAddress('::1')).toBe(true);
        expect(_isPrivateAddress('fc00::1')).toBe(true);
        expect(_isPrivateAddress('fd12:3456::1')).toBe(true);
        expect(_isPrivateAddress('fe80::1')).toBe(true);
    });

    test('blocks IPv4-mapped IPv6 private ranges', () => {
        expect(_isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
        expect(_isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    });

    test('allows public IPv6', () => {
        expect(_isPrivateAddress('2001:4860:4860::8888')).toBe(false); // Google DNS
    });

    test('treats unparseable input as unsafe', () => {
        expect(_isPrivateAddress('not-an-ip')).toBe(true);
    });
});

describe('assertSafeHttpUrl', () => {
    test('rejects non-string / empty input', async () => {
        await expect(assertSafeHttpUrl('')).rejects.toThrow(/required/);
        await expect(assertSafeHttpUrl(null)).rejects.toThrow(/required/);
        await expect(assertSafeHttpUrl(undefined)).rejects.toThrow(/required/);
    });

    test('rejects malformed URLs', async () => {
        await expect(assertSafeHttpUrl('not a url')).rejects.toThrow(/malformed/);
    });

    test('rejects non-http(s) protocols', async () => {
        await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toThrow(/http or https/);
        await expect(assertSafeHttpUrl('gopher://example.com/')).rejects.toThrow(/http or https/);
        await expect(assertSafeHttpUrl('ftp://example.com/')).rejects.toThrow(/http or https/);
    });

    test('enforces https when requireHttps=true', async () => {
        await expect(
            assertSafeHttpUrl('http://example.com/', { requireHttps: true })
        ).rejects.toThrow(/https/);
    });

    test('rejects blocked literal hostnames', async () => {
        await expect(assertSafeHttpUrl('http://localhost/')).rejects.toThrow(/not permitted/);
        await expect(assertSafeHttpUrl('http://metadata.google.internal/')).rejects.toThrow(/not permitted/);
        await expect(assertSafeHttpUrl('http://foo.localhost/')).rejects.toThrow(/not permitted/);
    });

    test('rejects literal private IPs as hostnames', async () => {
        await expect(assertSafeHttpUrl('http://127.0.0.1/')).rejects.toThrow(/non-public/);
        await expect(assertSafeHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/non-public/);
        await expect(assertSafeHttpUrl('http://10.0.0.1/')).rejects.toThrow(/non-public/);
        await expect(assertSafeHttpUrl('http://[::1]/')).rejects.toThrow(/non-public/);
    });

    test('rejects hostnames that cannot be resolved', async () => {
        await expect(
            assertSafeHttpUrl('http://this-hostname-definitely-does-not-exist-12345.invalid/')
        ).rejects.toThrow(/resolved/);
    });
});
