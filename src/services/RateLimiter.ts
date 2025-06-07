// src/services/RateLimiter.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from './AuditLogger';

export interface RateLimitEntry { // Moved to top level
  count: number;
  windowStartTimestamp: number; // When the current window for this entry started
}

export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | undefined>;
  set(key: string, entry: RateLimitEntry, windowSeconds: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  /** Optional atomic increment. If not present, RateLimiter will do get-then-set. */
  increment?(key: string, now: number, windowSeconds: number, maxRequests: number): Promise<{ currentCount: number; allowed: boolean; windowStartTimestamp: number }>;
  clearAll?(): Promise<void>;
  // Optional: A method to explicitly expire entries, if store doesn't do it automatically
  // cleanupExpired?(key: string, now: number, windowSeconds: number): Promise<boolean>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, RateLimitEntry> = new Map();
  private auditLogger: AuditLogger; // For logging internal store events if needed

  constructor(logProvider?: LogProvider) {
    // This logger is for the store itself, separate from RateLimiter's main logger if desired
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('service', 'InMemoryRateLimitStore');
    this.auditLogger.logSystemActivity('InMemoryRateLimitStore initialized');
  }

  async get(key: string): Promise<RateLimitEntry | undefined> {
    return this.store.get(key);
  }

  async set(key: string, entry: RateLimitEntry, _windowSeconds: number): Promise<void> {
    // _windowSeconds could be used here for stores like Redis to set TTL
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async clearAll(): Promise<void> {
      const clearedCount = this.store.size;
      this.store.clear();
      this.auditLogger.logSystemActivity('InMemoryRateLimitStore cleared', {clearedCount});
  }

  // Implementing optional atomic increment for InMemoryStore
  async increment(key: string, now: number, windowSeconds: number, maxRequests: number): Promise<{ currentCount: number; allowed: boolean; windowStartTimestamp: number }> {
    const windowStartForNewOrExpired = now; // If new or expired, current time is window start
    let entry = this.store.get(key);

    if (entry && entry.windowStartTimestamp < (now - windowSeconds * 1000)) {
      this.auditLogger.logSystemActivity('InMemoryStore: Entry expired, resetting', { key, oldWindowStart: new Date(entry.windowStartTimestamp).toISOString() });
      entry = undefined; // Reset if window expired
    }

    if (!entry) {
      entry = { count: 1, windowStartTimestamp: windowStartForNewOrExpired };
      this.store.set(key, entry);
      return { currentCount: entry.count, allowed: true, windowStartTimestamp: entry.windowStartTimestamp };
    }

    if (entry.count < maxRequests) {
      entry.count++;
      // No need to this.store.set(key, entry) here as 'entry' is a reference to the object in the map.
      // However, if it was a copy, we would need to set it. Let's be explicit for clarity.
      this.store.set(key, entry);
      return { currentCount: entry.count, allowed: true, windowStartTimestamp: entry.windowStartTimestamp };
    }

    // Count is at or exceeds maxRequests
    return { currentCount: entry.count, allowed: false, windowStartTimestamp: entry.windowStartTimestamp };
  }
}


export class RateLimiter {
  private store: RateLimitStore;
  private auditLogger: AuditLogger;

  constructor(store?: RateLimitStore, logProvider?: LogProvider) {
    this.store = store || new InMemoryRateLimitStore(logProvider); // Default to InMemoryStore
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('service', 'RateLimiter');
    this.auditLogger.logSystemActivity('RateLimiter initialized with a store');
  }

  public async isAllowed(identifier: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    const now = Date.now();

    if (this.store.increment) { // Use atomic increment if store supports it
      const { currentCount, allowed, windowStartTimestamp } = await this.store.increment(identifier, now, windowSeconds, maxRequests);
      
      // Log based on the outcome of the atomic operation
      if (allowed) {
        if (currentCount === 1 && windowStartTimestamp === now) { // Check if it's truly a new entry by window start
             this.auditLogger.logEvent('RATE_LIMIT_NEW_IDENTIFIER_ATOMIC', { identifier, count: currentCount, maxRequests, windowSeconds }, undefined, identifier, 'INFO');
        } else {
            this.auditLogger.logEvent('RATE_LIMIT_ALLOWED_ATOMIC', { identifier, count: currentCount, maxRequests, windowSeconds }, undefined, identifier, 'SUCCESS');
        }
        return true;
      } else {
        this.auditLogger.logEvent('RATE_LIMIT_BLOCKED_ATOMIC', { identifier, count: currentCount, maxRequests, windowSeconds }, undefined, identifier, 'FAILURE');
        return false;
      }
    } else { // Fallback to get-then-set logic
      let entry = await this.store.get(identifier);
      const windowStartTimeForEntry = now - (windowSeconds * 1000);

      if (entry && entry.windowStartTimestamp < windowStartTimeForEntry) {
        this.auditLogger.logSystemActivity('Rate limit window expired, resetting count (get-set path)', { identifier, oldWindowStart: new Date(entry.windowStartTimestamp).toISOString() });
        entry = undefined;
      }

      if (!entry) {
        const newEntry: RateLimitEntry = { count: 1, windowStartTimestamp: now };
        await this.store.set(identifier, newEntry, windowSeconds);
        this.auditLogger.logEvent('RATE_LIMIT_NEW_IDENTIFIER', { identifier, count: newEntry.count, maxRequests, windowSeconds }, undefined, identifier, 'INFO');
        return true;
      }

      if (entry.count < maxRequests) {
        entry.count++;
        await this.store.set(identifier, entry, windowSeconds); // Update the count and potentially refresh TTL in external store
        this.auditLogger.logEvent('RATE_LIMIT_ALLOWED', { identifier, count: entry.count, maxRequests, windowSeconds }, undefined, identifier, 'SUCCESS');
        return true;
      } else {
        this.auditLogger.logEvent('RATE_LIMIT_BLOCKED', { identifier, count: entry.count, maxRequests, windowSeconds }, undefined, identifier, 'FAILURE');
        return false;
      }
    }
  }

  public async clearAll(): Promise<void> {
    if (this.store.clearAll) {
      await this.store.clearAll();
      this.auditLogger.logSystemActivity('All rate limit entries cleared via store.clearAll()');
    } else {
      // Fallback or error if store doesn't support clearAll - for InMemory, it does.
      this.auditLogger.logSystemActivity('RateLimiter.clearAll called, but store may not support it or no specific implementation.', {}, 'warn');
      // For InMemoryRateLimitStore, this won't be an issue.
    }
    return false;
  }

  public async resetIdentifier(identifier: string): Promise<boolean> {
    const deleted = await this.store.delete(identifier);
    if (deleted) {
      this.auditLogger.logSystemActivity('Rate limit reset for identifier via store.delete()', { identifier });
    }
    return deleted;
  }

  // getIdentifierState might be harder if store is external, or could be a pass-through
  // public async getIdentifierState(identifier: string): Promise<RateLimitEntry | undefined> {
  //   return this.store.get(identifier);
  // }
}
