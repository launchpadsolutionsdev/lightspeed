/**
 * Simple In-Memory Cache with TTL
 *
 * Provides TTL-based caching for hot paths (auth lookups, KB entries,
 * response rules, usage counts) without requiring Redis.
 *
 * Suitable for single-process deployments. For multi-process or
 * multi-server deployments, replace with Redis.
 */

class MemoryCache {
    constructor() {
        this.store = new Map();

        // Cleanup expired entries every 60 seconds
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    }

    /**
     * Get a value from cache.
     * @param {string} key
     * @returns {*} The cached value, or undefined if expired/missing
     */
    get(key) {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }

        return entry.value;
    }

    /**
     * Set a value in cache with a TTL.
     * @param {string} key
     * @param {*} value
     * @param {number} ttlMs - Time-to-live in milliseconds
     */
    set(key, value, ttlMs) {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + ttlMs
        });
    }

    /**
     * Delete a specific key.
     */
    del(key) {
        this.store.delete(key);
    }

    /**
     * Delete all keys matching a prefix.
     * Useful for cache invalidation (e.g., invalidate all KB cache for an org).
     */
    invalidatePrefix(prefix) {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
            }
        }
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (now > entry.expiresAt) {
                this.store.delete(key);
            }
        }
    }

    /**
     * Stop the cleanup interval (for graceful shutdown / tests).
     */
    destroy() {
        clearInterval(this._cleanupInterval);
    }
}

// Singleton instance
const cache = new MemoryCache();

// Cache TTL constants
const TTL = {
    AUTH_ORG:       5 * 60 * 1000,  // 5 minutes — user→org mapping
    KB_ENTRIES:     2 * 60 * 1000,  // 2 minutes — KB entries per org
    RESPONSE_RULES: 2 * 60 * 1000, // 2 minutes — response rules per org
    USAGE_COUNT:    60 * 1000,      // 60 seconds — monthly usage count
};

module.exports = { cache, TTL, MemoryCache };
