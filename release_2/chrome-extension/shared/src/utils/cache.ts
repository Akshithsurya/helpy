interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  lastAccessed: number;
  accessCount: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

type EvictCallback<T> = (key: string, value: T) => void;

export class Cache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private defaultTTL: number;
  private maxSize: number;
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;
  private onEvictCb: EvictCallback<T> | null = null;

  constructor(defaultTTL = 60000, maxSize = 500, onEvict?: EvictCallback<T>) {
    this.defaultTTL = defaultTTL;
    this.maxSize = Math.max(1, maxSize);
    this.onEvictCb = onEvict || null;
  }

  set(key: string, value: T, ttl?: number): void {
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

  private evictLRU(count: number): void {
    if (this.cache.size === 0) return;
    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    const toRemove = entries.slice(0, Math.min(count, entries.length));
    for (const [k, v] of toRemove) {
      if (this.onEvictCb) {
        try { this.onEvictCb(k, v.value); } catch { /* ignore */ }
      }
      this.cache.delete(k);
      this.evictions++;
    }
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      if (this.onEvictCb) {
        try { this.onEvictCb(key, entry.value); } catch { /* ignore */ }
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

  peek(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > entry.ttl) return undefined;
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry && this.onEvictCb) {
      try { this.onEvictCb(key, entry.value); } catch { /* ignore */ }
    }
    return this.cache.delete(key);
  }

  clear(): void {
    if (this.onEvictCb) {
      for (const [k, v] of this.cache.entries()) {
        try { this.onEvictCb(k, v.value); } catch { /* ignore */ }
      }
    }
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  setMaxSize(newSize: number): void {
    const n = Math.max(1, newSize);
    if (n < this.cache.size) {
      this.evictLRU(this.cache.size - n);
    }
    this.maxSize = n;
  }

  stats(): CacheStats {
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

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  warmUp(entries: Array<[string, T]>, ttl?: number): void {
    for (const [k, v] of entries) {
      this.set(k, v, ttl);
    }
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  values(): T[] {
    const result: T[] = [];
    const now = Date.now();
    for (const [k, v] of this.cache.entries()) {
      if (now - v.timestamp <= v.ttl) {
        result.push(v.value);
      }
    }
    return result;
  }
}

export const ipcCache = new Cache(30000, 200);

