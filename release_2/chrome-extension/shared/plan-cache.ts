interface CacheNode<T> {
  key: string;
  value: T;
  expiresAt: number;
  prev: CacheNode<T> | null;
  next: CacheNode<T> | null;
}

export class SimpleCache<T> {
  private _map: Map<string, CacheNode<T>>;
  private _head: CacheNode<T> | null;
  private _tail: CacheNode<T> | null;
  private _hits: number;
  private _misses: number;
  maxSize: number;
  defaultTtlMs: number;

  constructor(maxSize: number = 200, defaultTtlMs: number = 300000) {
    this._map = new Map();
    this._head = null;
    this._tail = null;
    this._hits = 0;
    this._misses = 0;
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
  }

  private _removeNode(node: CacheNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this._head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this._tail = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  private _moveToHead(node: CacheNode<T>): void {
    this._removeNode(node);
    node.next = this._head;
    node.prev = null;
    if (this._head) {
      this._head.prev = node;
    }
    this._head = node;
    if (!this._tail) {
      this._tail = node;
    }
  }

  private _evictTail(): void {
    if (this._tail) {
      const oldTail = this._tail;
      this._removeNode(oldTail);
      this._map.delete(oldTail.key);
    }
  }

  set(key: string, value: T, ttlMs?: number): boolean {
    const existing = this._map.get(key);
    const ttl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    if (existing) {
      existing.value = value;
      existing.expiresAt = expiresAt;
      this._moveToHead(existing);
      return true;
    }

    while (this._map.size >= this.maxSize && this.maxSize > 0) {
      this._evictTail();
    }

    const node: CacheNode<T> = {
      key,
      value,
      expiresAt,
      prev: null,
      next: this._head,
    };

    if (this._head) {
      this._head.prev = node;
    }
    this._head = node;
    if (!this._tail) {
      this._tail = node;
    }
    this._map.set(key, node);
    return true;
  }

  get(key: string): T | null {
    const node = this._map.get(key);
    if (!node) {
      this._misses++;
      return null;
    }
    if (Date.now() > node.expiresAt) {
      this._removeNode(node);
      this._map.delete(key);
      this._misses++;
      return null;
    }
    this._hits++;
    this._moveToHead(node);
    return node.value;
  }

  has(key: string): boolean {
    const node = this._map.get(key);
    if (!node) return false;
    if (Date.now() > node.expiresAt) {
      this._removeNode(node);
      this._map.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    const node = this._map.get(key);
    if (!node) return false;
    this._removeNode(node);
    return this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
    this._head = null;
    this._tail = null;
    this._hits = 0;
    this._misses = 0;
  }

  size(): number {
    const now = Date.now();
    let count = 0;
    for (const node of this._map.values()) {
      if (now <= node.expiresAt) count++;
    }
    return count;
  }

  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      size: this.size(),
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
    };
  }
}
