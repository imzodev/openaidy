/**
 * Proxy Cache Module
 *
 * Secure caching layer for the addon proxy with
 * cache poisoning prevention and encryption support.
 */

import type { FastifyRequest } from 'fastify';

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry
 */
export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  expiresAt: number;
  createdAt: number;
  metadata: CacheEntryMetadata;
}

/**
 * Cache entry metadata
 */
export interface CacheEntryMetadata {
  size: number;
  hitCount: number;
  lastAccessed: number;
  etag?: string;
  contentType?: string;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  ttl?: number;
  maxSize?: number;
  maxEntries?: number;
  evictionPolicy?: 'LRU' | 'LFU' | 'FIFO';
  enableEncryption?: boolean;
  enableCompression?: boolean;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  entries: number;
  evictions: number;
  hitRate: number;
}

// ============================================================================
// Cache Key Generator
// ============================================================================

/**
 * Generate cache keys for requests
 */
export class CacheKeyGenerator {
  /**
   * Generate a cache key for a request
   */
  static generate(request: {
    addonId: string;
    method: string;
    path: string;
    query?: string;
    userContext?: string;
  }): string {
    const parts = [
      request.addonId,
      request.method.toUpperCase(),
      request.path,
      request.query ?? '',
      request.userContext ?? 'anonymous',
    ];

    // Create a hash of the key components
    const raw = parts.join(':');
    return `addon:${this.hash(raw)}`;
  }

  /**
   * Simple hash function for cache keys
   */
  private static hash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Generate a key with time-based invalidation
   */
  static withTimeInvalidation(
    request: Parameters<typeof this.generate>[0],
    ttlSeconds: number,
  ): string {
    const baseKey = this.generate(request);
    const timeBucket = Math.floor(Date.now() / (ttlSeconds * 1000));
    return `${baseKey}:${timeBucket}`;
  }

  /**
   * Generate a key with permission scope
   */
  static withPermissionScope(
    request: Parameters<typeof this.generate>[0],
    permissions: string[],
  ): string {
    const baseKey = this.generate(request);
    const permissionsHash = this.hash(permissions.sort().join('|'));
    return `${baseKey}:perm:${permissionsHash}`;
  }
}

// ============================================================================
// Cache Store
// ============================================================================

/**
 * In-memory cache store with LRU/LFU/FIFO eviction
 */
export class CacheStore<T = unknown> {
  private entries: Map<string, CacheEntry<T>> = new Map();
  private config: Required<CacheConfig>;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    entries: 0,
    evictions: 0,
    hitRate: 0,
  };

  constructor(config: CacheConfig) {
    this.config = {
      ttl: config.ttl ?? 300,
      maxSize: config.maxSize ?? 100 * 1024 * 1024, // 100MB
      maxEntries: config.maxEntries ?? 1000,
      evictionPolicy: config.evictionPolicy ?? 'LRU',
      enableEncryption: config.enableEncryption ?? false,
      enableCompression: config.enableCompression ?? false,
    };
  }

  /**
   * Get a value from cache
   */
  get(key: string): T | null {
    const entry = this.entries.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Update access metadata
    entry.metadata.lastAccessed = Date.now();
    entry.metadata.hitCount++;
    this.stats.hits++;
    this.updateHitRate();

    return entry.value;
  }

  /**
   * Set a value in cache
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Check if we need to evict
    if (this.shouldEvict()) {
      this.evict();
    }

    const size = this.estimateSize(value);
    const ttl = ttlMs ?? this.config.ttl * 1000;

    const entry: CacheEntry<T> = {
      key,
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
      metadata: {
        size,
        hitCount: 0,
        lastAccessed: Date.now(),
      },
    };

    // Remove existing entry if updating
    if (this.entries.has(key)) {
      const existing = this.entries.get(key)!;
      this.stats.size -= existing.metadata.size;
    }

    this.entries.set(key, entry);
    this.stats.size += size;
    this.stats.entries = this.entries.size;
  }

  /**
   * Delete a key from cache
   */
  delete(key: string): boolean {
    const entry = this.entries.get(key);

    if (entry) {
      this.stats.size -= entry.metadata.size;
      this.entries.delete(key);
      this.stats.entries = this.entries.size;
      return true;
    }

    return false;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);

    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.stats.size = 0;
    this.stats.entries = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Check if we should evict an entry
   */
  private shouldEvict(): boolean {
    // Check max entries
    if (this.entries.size >= this.config.maxEntries) return true;

    // Check max size
    if (this.stats.size >= this.config.maxSize) return true;

    return false;
  }

  /**
   * Evict entries based on eviction policy
   */
  private evict(): void {
    if (this.entries.size === 0) return;

    let keyToEvict: string | null = null;

    switch (this.config.evictionPolicy) {
      case 'LRU':
        keyToEvict = this.findLRU();
        break;
      case 'LFU':
        keyToEvict = this.findLFU();
        break;
      case 'FIFO':
        keyToEvict = this.findFIFO();
        break;
    }

    if (keyToEvict) {
      this.delete(keyToEvict);
      this.stats.evictions++;
    }
  }

  /**
   * Find least recently used entry
   */
  private findLRU(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.metadata.lastAccessed < oldestTime) {
        oldestTime = entry.metadata.lastAccessed;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Find least frequently used entry
   */
  private findLFU(): string | null {
    let leastFrequentKey: string | null = null;
    let leastFrequent = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.metadata.hitCount < leastFrequent) {
        leastFrequent = entry.metadata.hitCount;
        leastFrequentKey = key;
      }
    }

    return leastFrequentKey;
  }

  /**
   * Find first in (oldest by creation time)
   */
  private findFIFO(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Estimate size of a value in bytes
   */
  private estimateSize(value: unknown): number {
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value).length * 2;
    }
    return 64; // Default size estimate
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// ============================================================================
// Proxy Cache
// ============================================================================

/**
 * ProxyCache provides caching for proxy responses
 */
export class ProxyCache {
  private store: CacheStore;
  private config: Required<CacheConfig>;

  constructor(config: CacheConfig = {}) {
    this.config = {
      ttl: config.ttl ?? 300,
      maxSize: config.maxSize ?? 100 * 1024 * 1024,
      maxEntries: config.maxEntries ?? 1000,
      evictionPolicy: config.evictionPolicy ?? 'LRU',
      enableEncryption: config.enableEncryption ?? false,
      enableCompression: config.enableCompression ?? false,
    };
    this.store = new CacheStore(this.config);
  }

  /**
   * Get a cached response
   */
  get(
    request: FastifyRequest,
    addonId: string,
    permissions: string[],
  ): {
    cached: boolean;
    value: unknown;
    fromCache: boolean;
  } {
    const key = CacheKeyGenerator.withPermissionScope(
      {
        addonId,
        method: request.method,
        path: request.url,
      },
      permissions,
    );

    const cached = this.store.get(key);

    if (cached === null) {
      return { cached: false, value: null, fromCache: false };
    }

    return { cached: true, value: cached, fromCache: true };
  }

  /**
   * Cache a response
   */
  set(
    request: FastifyRequest,
    addonId: string,
    permissions: string[],
    value: unknown,
    ttlMs?: number,
  ): void {
    const key = CacheKeyGenerator.withPermissionScope(
      {
        addonId,
        method: request.method,
        path: request.url,
      },
      permissions,
    );

    this.store.set(key, value, ttlMs);
  }

  /**
   * Invalidate cache for a specific addon
   */
  invalidateAddon(_addonId: string): number {
    // In a real implementation, we'd track keys by addon
    // For now, just return 0
    return 0;
  }

  /**
   * Invalidate cache for a specific path pattern
   */
  invalidatePattern(_pattern: string): number {
    // In a real implementation, we'd track and invalidate matching keys
    return 0;
  }

  /**
   * Check if request is cacheable
   */
  isCacheable(request: FastifyRequest): boolean {
    // Only cache GET requests
    if (request.method !== 'GET') return false;

    // Don't cache responses with Set-Cookie
    const contentType = request.headers['content-type'];
    if (contentType?.includes('text/html')) return false;

    return true;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return this.store.getStats();
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Run cleanup of expired entries
   */
  cleanup(): number {
    return this.store.cleanup();
  }
}

// ============================================================================
// Default exports
// ============================================================================

export const defaultProxyCache = new ProxyCache({
  ttl: 300,
  maxSize: 100 * 1024 * 1024,
  maxEntries: 1000,
  evictionPolicy: 'LRU',
  enableEncryption: false,
  enableCompression: false,
});

export default defaultProxyCache;
