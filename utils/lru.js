// utils/lru.js
// Simple LRU cache with TTL for Gutenberg resolver results

class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    
    const item = this.cache.get(key);
    
    // Check TTL
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    
    return item.value;
  }

  set(key, value, ttlMs) {
    // Remove if exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // Add new item
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    
    // Evict oldest if over limit
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  has(key) {
    return this.cache.has(key) && Date.now() <= this.cache.get(key).expiresAt;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

// Gutenberg resolver cache
const gutenbergCache = new LRUCache(500);

module.exports = { LRUCache, gutenbergCache };
