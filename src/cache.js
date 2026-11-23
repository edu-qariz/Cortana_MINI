'use strict';

const pruners = new Set();

class TTLMap {
    constructor({ ttlMs = 60_000, max = 500, name = 'cache' } = {}) {
        this.ttlMs = ttlMs;
        this.max = max;
        this.name = name;
        this.map = new Map();
        pruners.add(this);
    }

    set(key, value, ttlMs = this.ttlMs) {
        if (this.map.size >= this.max && !this.map.has(key)) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined) this.map.delete(oldest);
        }
        this.map.set(key, { value, expires: Date.now() + ttlMs });
        return value;
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (entry.expires <= Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        return entry.value;
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    delete(key) {
        return this.map.delete(key);
    }

    prune() {
        const now = Date.now();
        for (const [key, entry] of this.map) {
            if (entry.expires <= now) this.map.delete(key);
        }
    }

    clear() {
        this.map.clear();
    }

    entries() {
        const now = Date.now();
        const out = [];
        for (const [key, entry] of this.map) {
            if (entry.expires <= now) {
                this.map.delete(key);
                continue;
            }
            out.push([key, entry.value]);
        }
        return out;
    }

    get size() {
        return this.map.size;
    }
}

class RateLimiter {
    constructor({ limit = 8, windowMs = 10_000 } = {}) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.map = new Map();
        pruners.add(this);
    }

    take(key) {
        const now = Date.now();
        const bucket = this.map.get(key);
        if (!bucket || bucket.reset <= now) {
            this.map.set(key, { count: 1, reset: now + this.windowMs });
            return { allowed: true, remaining: this.limit - 1 };
        }
        if (bucket.count >= this.limit) {
            return { allowed: false, retryAfter: Math.ceil((bucket.reset - now) / 1000) };
        }
        bucket.count += 1;
        return { allowed: true, remaining: this.limit - bucket.count };
    }

    prune() {
        const now = Date.now();
        for (const [key, bucket] of this.map) {
            if (bucket.reset <= now) this.map.delete(key);
        }
    }

    clear() {
        this.map.clear();
    }
}

class SeenSet {
    constructor({ ttlMs = 120_000, max = 2000 } = {}) {
        this.set = new TTLMap({ ttlMs, max, name: 'seen' });
    }

    add(id) {
        if (this.set.has(id)) return false;
        this.set.set(id, true);
        return true;
    }
}

function pruneAll() {
    for (const pruner of pruners) {
        try { pruner.prune(); } catch { /* keep going */ }
    }
}

function stats() {
    return [...pruners].map((p) => ({
        name: p.name || p.constructor.name,
        size: p.size ?? p.map?.size ?? 0,
    }));
}

module.exports = { TTLMap, RateLimiter, SeenSet, pruneAll, stats };
