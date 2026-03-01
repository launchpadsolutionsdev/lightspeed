const { MemoryCache } = require('../../src/services/cache');

describe('MemoryCache', () => {
    let testCache;

    beforeEach(() => {
        testCache = new MemoryCache();
    });

    afterEach(() => {
        testCache.destroy();
    });

    it('stores and retrieves values', () => {
        testCache.set('key1', 'value1', 60000);
        expect(testCache.get('key1')).toBe('value1');
    });

    it('returns undefined for missing keys', () => {
        expect(testCache.get('nonexistent')).toBeUndefined();
    });

    it('respects TTL expiration', () => {
        testCache.set('key1', 'value1', 1); // 1ms TTL

        // Wait for expiration
        return new Promise(resolve => {
            setTimeout(() => {
                expect(testCache.get('key1')).toBeUndefined();
                resolve();
            }, 10);
        });
    });

    it('deletes specific keys', () => {
        testCache.set('key1', 'value1', 60000);
        testCache.del('key1');
        expect(testCache.get('key1')).toBeUndefined();
    });

    it('invalidates by prefix', () => {
        testCache.set('rules:org1', 'data1', 60000);
        testCache.set('rules:org2', 'data2', 60000);
        testCache.set('kb:org1', 'data3', 60000);

        testCache.invalidatePrefix('rules:');

        expect(testCache.get('rules:org1')).toBeUndefined();
        expect(testCache.get('rules:org2')).toBeUndefined();
        expect(testCache.get('kb:org1')).toBe('data3');
    });

    it('handles null and undefined values', () => {
        testCache.set('null_val', null, 60000);
        // null is a valid cached value (e.g., org not found)
        expect(testCache.get('null_val')).toBeNull();
    });

    it('overwrites existing keys', () => {
        testCache.set('key1', 'old', 60000);
        testCache.set('key1', 'new', 60000);
        expect(testCache.get('key1')).toBe('new');
    });

    it('stores objects correctly', () => {
        const obj = { id: 1, name: 'test', nested: { a: 1 } };
        testCache.set('obj', obj, 60000);
        expect(testCache.get('obj')).toEqual(obj);
    });
});
