/**
 * SONEC Completion Cache
 * 
 * LRU-based cache for completion results with TTL expiration.
 * Provides sub-millisecond lookups for repeated completion patterns.
 */

import * as vscode from 'vscode';
import { CompletionResult, CacheStats } from '../core/types';
import { ConfigManager } from '../core/config';

interface CacheItem {
  result: CompletionResult;
  createdAt: number;
  hits: number;
}

/**
 * Manages the caching of completion results to improve latency and reduce model calls.
 */
export class CompletionCache implements vscode.Disposable {
  private cache: Map<string, CacheItem> = new Map();
  private config: ConfigManager;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    hitRate: 0,
  };
  private readonly MAX_SIZE = 200;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.config = ConfigManager.getInstance();

    // Periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => this.evictExpired(), 30_000);
  }

  /**
   * Get a cached completion result.
   * @param key The unique cache key string
   * @returns The cached completion result or null if not found or expired
   */
  get(key: string): CompletionResult | null {
    if (!this.config.getValue('cacheEnabled')) {
      return null;
    }

    const item = this.cache.get(key);
    if (!item) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check TTL
    const ttl = this.config.getValue('cacheTTLSeconds') * 1000;
    if (Date.now() - item.createdAt > ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      this.updateHitRate();
      return null;
    }

    // LRU: move to end (most recently used)
    this.cache.delete(key);
    item.hits++;
    this.cache.set(key, item);

    this.stats.hits++;
    this.updateHitRate();
    return item.result;
  }

  /**
   * Store a completion result in the cache.
   * @param key The unique cache key string
   * @param result The completion result to store
   */
  set(key: string, result: CompletionResult): void {
    if (!this.config.getValue('cacheEnabled')) {
      return;
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        this.stats.evictions++;
      }
    }

    this.cache.set(key, {
      result,
      createdAt: Date.now(),
      hits: 0,
    });

    this.stats.size = this.cache.size;
  }

  /**
   * Invalidate cache entries matching a specific file path.
   * @param filePath The relative path to the file
   */
  invalidateFile(filePath: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(filePath)) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }
    this.stats.size = this.cache.size;
  }

  /**
   * Clear entire cache and reset stats.
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      hitRate: 0,
    };
  }

  /**
   * Get cache performance statistics.
   * @returns The current cache stats
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Remove expired entries from the cache.
   */
  private evictExpired(): void {
    const ttl = this.config.getValue('cacheTTLSeconds') * 1000;
    const now = Date.now();

    for (const [key, item] of this.cache) {
      if (now - item.createdAt > ttl) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }

    this.stats.size = this.cache.size;
  }

  /**
   * Update the calculated hit rate.
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Disposes the completion cache resources.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cache.clear();
  }
}
