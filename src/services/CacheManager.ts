// src/services/CacheManager.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from './AuditLogger';

interface CacheEntry<T = any> {
  value: T;
  expiresAt?: number; // Timestamp
}

export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private auditLogger: AuditLogger;
  private defaultTTLSeconds: number = 60 * 5;
  private maxSize: number; // Added for size limit

  constructor(logProvider?: LogProvider, defaultTTLSeconds?: number, maxSize: number = 1000) { // Added maxSize
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('service', 'CacheManager');
    if (defaultTTLSeconds !== undefined && defaultTTLSeconds > 0) {
      this.defaultTTLSeconds = defaultTTLSeconds;
    }
    this.maxSize = maxSize > 0 ? maxSize : 1000; // Ensure maxSize is positive
    this.auditLogger.logSystemActivity('CacheManager initialized', {
      defaultTTLSeconds: this.defaultTTLSeconds,
      maxSize: this.maxSize
    });
  }

  // ... (isExpired, cleanupKeyIfExpired, get methods as before)
  private isExpired(entry: CacheEntry): boolean {
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      return true;
    }
    return false;
  }

  private cleanupKeyIfExpired(key: string, entry?: CacheEntry): boolean {
    const currentEntry = entry || this.cache.get(key);
    if (currentEntry && this.isExpired(currentEntry)) {
      this.cache.delete(key);
      this.auditLogger.logSystemActivity('Cache key expired and removed', { key });
      return true;
    }
    return false;
  }

  public get<T = any>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.auditLogger.logEvent('CACHE_MISS', { key }, undefined, undefined, 'INFO');
      return undefined;
    }
    if (this.cleanupKeyIfExpired(key, entry)) {
      this.auditLogger.logEvent('CACHE_MISS', { key, reason: 'expired' }, undefined, undefined, 'INFO');
      return undefined;
    }
    this.auditLogger.logEvent('CACHE_HIT', { key }, undefined, undefined, 'SUCCESS');
    return entry.value as T;
  }


  public set<T = any>(key: string, value: T, ttlSeconds?: number): void {
    const effectiveTTL = ttlSeconds !== undefined && ttlSeconds > 0 ? ttlSeconds : this.defaultTTLSeconds;
    const expiresAt = Date.now() + (effectiveTTL * 1000);

    // Eviction logic: If key is new and cache is full or over size, evict oldest.
    // If key already exists, we are just updating it, so size doesn't change.
    // Eviction only occurs when adding a *new* element to a *full* cache.
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
        const oldestKey = this.cache.keys().next().value; // FIFO: Map maintains insertion order
        if (oldestKey) { // Should always be true if cache.size >= maxSize > 0
            this.cache.delete(oldestKey); // Use direct delete, del() would log CACHE_DELETE
            this.auditLogger.logEvent('CACHE_EVICTION_FIFO', {
                evictedKey: oldestKey,
                newKey: key,
                cacheSizeBeforeEviction: this.maxSize, // It was at maxSize
                maxCacheSize: this.maxSize
            }, undefined, undefined, 'INFO');
        }
    }

    this.cache.set(key, { value, expiresAt });
    this.auditLogger.logEvent('CACHE_SET', { key, ttlSeconds: effectiveTTL }, undefined, undefined, 'SUCCESS');
  }

  // ... (del, clear, has, count, cleanupExpiredKeys methods as before)
  public del(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.auditLogger.logEvent('CACHE_DELETE', { key }, undefined, undefined, 'SUCCESS');
    } else {
      this.auditLogger.logEvent('CACHE_DELETE_ATTEMPT', { key, found: false }, undefined, undefined, 'INFO');
    }
    return deleted;
  }

  public clear(): void {
    const keyCount = this.cache.size;
    this.cache.clear();
    this.auditLogger.logEvent('CACHE_CLEAR', { clearedKeys: keyCount }, undefined, undefined, 'SUCCESS');
  }

  public has(key: string): boolean {
    if (!this.cache.has(key)) return false;
    if (this.cleanupKeyIfExpired(key)) {
        return false;
    }
    return true;
  }

  public count(): number {
    return this.cache.size;
  }

  public cleanupExpiredKeys(): number {
    let removedCount = 0;
    for (const key of this.cache.keys()) { // Iterate over keys to avoid issues with deleting during iteration if using entries()
        if (this.cleanupKeyIfExpired(key)) { // cleanupKeyIfExpired also deletes
            removedCount++;
        }
    }
    if (removedCount > 0) {
        this.auditLogger.logSystemActivity(`Periodic cleanup removed ${removedCount} expired keys`, { removedCount });
    }
    return removedCount;
  }
}
