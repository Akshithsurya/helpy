"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ipcCache = exports.Cache = void 0;
class Cache {
    constructor(defaultTTL = 60000, maxSize = 500, onEvict) {
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
        this.onEvictCb = null;
        this.defaultTTL = defaultTTL;
        this.maxSize = Math.max(1, maxSize);
        this.onEvictCb = onEvict || null;
    }
    set(key, value, ttl) {
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictLRU(Math.max(1, Math.floor(this.maxSize * 0.1)));
        }
        const now = Date.now();
        this.cache.set(key, {
            value,
            timestamp: now,
            ttl: ttl || this.defaultTTL,
            lastAccessed: now,
            accessCount: 0,
        });
    }
    evictLRU(count) {
        if (this.cache.size === 0)
            return;
        const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
        const toRemove = entries.slice(0, Math.min(count, entries.length));
        for (const [k, v] of toRemove) {
            if (this.onEvictCb) {
                try {
                    this.onEvictCb(k, v.value);
                }
                catch { /* ignore */ }
            }
            this.cache.delete(k);
            this.evictions++;
        }
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }
        const now = Date.now();
        if (now - entry.timestamp > entry.ttl) {
            if (this.onEvictCb) {
                try {
                    this.onEvictCb(key, entry.value);
                }
                catch { /* ignore */ }
            }
            this.cache.delete(key);
            this.evictions++;
            this.misses++;
            return undefined;
        }
        entry.lastAccessed = now;
        entry.accessCount++;
        this.hits++;
        return entry.value;
    }
    peek(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        if (Date.now() - entry.timestamp > entry.ttl)
            return undefined;
        return entry.value;
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    delete(key) {
        const entry = this.cache.get(key);
        if (entry && this.onEvictCb) {
            try {
                this.onEvictCb(key, entry.value);
            }
            catch { /* ignore */ }
        }
        return this.cache.delete(key);
    }
    clear() {
        if (this.onEvictCb) {
            for (const [k, v] of this.cache.entries()) {
                try {
                    this.onEvictCb(k, v.value);
                }
                catch { /* ignore */ }
            }
        }
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
    getMaxSize() {
        return this.maxSize;
    }
    setMaxSize(newSize) {
        const n = Math.max(1, newSize);
        if (n < this.cache.size) {
            this.evictLRU(this.cache.size - n);
        }
        this.maxSize = n;
    }
    stats() {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: total === 0 ? 0 : this.hits / total,
        };
    }
    resetStats() {
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }
    warmUp(entries, ttl) {
        for (const [k, v] of entries) {
            this.set(k, v, ttl);
        }
    }
    keys() {
        return Array.from(this.cache.keys());
    }
    values() {
        const result = [];
        const now = Date.now();
        for (const [k, v] of this.cache.entries()) {
            if (now - v.timestamp <= v.ttl) {
                result.push(v.value);
            }
        }
        return result;
    }
}
exports.Cache = Cache;
exports.ipcCache = new Cache(30000, 200);
