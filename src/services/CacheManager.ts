// src/services/CacheManager.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from './AuditLogger';

interface CacheEntry<T = any> {
  value: T;
  expiresAt?: number; // Timestamp
}

export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private auditLogger: AuditLogger;
  private defaultTTLSeconds: number = 60 * 5; // Default 5 minutes

  constructor(logProvider?: LogProvider, defaultTTLSeconds?: number) {
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('service', 'CacheManager');
    if (defaultTTLSeconds !== undefined && defaultTTLSeconds > 0) {
      this.defaultTTLSeconds = defaultTTLSeconds;
    }
    this.auditLogger.logSystemActivity('CacheManager initialized', { defaultTTLSeconds: this.defaultTTLSeconds });

    // Optional: Start a periodic cleanup interval for expired keys
    // setInterval(() => this.cleanupExpiredKeys(), this.defaultTTLSeconds * 1000);
    // For simplicity in this subtask, cleanup is done on get/has.
  }

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

    this.cache.set(key, { value, expiresAt });
    this.auditLogger.logEvent('CACHE_SET', { key, ttlSeconds: effectiveTTL /* value: value - avoid logging sensitive values */ }, undefined, undefined, 'SUCCESS');
  }

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
    // Check if expired and remove if so, then return false
    if (this.cleanupKeyIfExpired(key)) {
        return false;
    }
    return true;
  }

  public count(): number {
    // Optionally, cleanup before count for accuracy, but might be slow
    // Array.from(this.cache.keys()).forEach(key => this.cleanupKeyIfExpired(key));
    return this.cache.size;
  }

  // Manual cleanup for all expired keys, could be called periodically
  public cleanupExpiredKeys(): number {
    let removedCount = 0;
    for (const key of this.cache.keys()) {
        if (this.cleanupKeyIfExpired(key)) {
            removedCount++;
        }
    }
    if (removedCount > 0) {
        this.auditLogger.logSystemActivity(`Periodic cleanup removed ${removedCount} expired keys`, { removedCount });
    }
    return removedCount;
  }
}
