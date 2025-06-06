// src/services/RateLimiter.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from './AuditLogger';

interface RateLimitEntry {
  count: number;
  windowStartTimestamp: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private auditLogger: AuditLogger;

  constructor(logProvider?: LogProvider) {
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('service', 'RateLimiter');
    this.auditLogger.logSystemActivity('RateLimiter initialized');
  }

  /**
   * Checks if a request from a given identifier is allowed based on maxRequests and windowSeconds.
   * @param identifier Typically an IP address or a user ID.
   * @param maxRequests Maximum number of requests allowed within the window.
   * @param windowSeconds The time window in seconds.
   * @returns True if the request is allowed, false otherwise.
   */
  public isAllowed(identifier: string, maxRequests: number, windowSeconds: number): boolean {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);

    let entry = this.store.get(identifier);

    // If entry exists and its window has expired, reset it
    if (entry && entry.windowStartTimestamp < windowStart) {
      this.auditLogger.logSystemActivity('Rate limit window expired, resetting count', { identifier, oldWindowStart: new Date(entry.windowStartTimestamp).toISOString() });
      entry = undefined; // Treat as new entry
    }

    if (!entry) {
      entry = { count: 1, windowStartTimestamp: now };
      this.store.set(identifier, entry);
      this.auditLogger.logEvent('RATE_LIMIT_NEW_IDENTIFIER', { identifier, count: entry.count, maxRequests, windowSeconds }, undefined, identifier, 'INFO');
      return true;
    }

    if (entry.count < maxRequests) {
      entry.count++;
      this.store.set(identifier, entry); // Update the count
      this.auditLogger.logEvent('RATE_LIMIT_ALLOWED', { identifier, count: entry.count, maxRequests, windowSeconds }, undefined, identifier, 'SUCCESS');
      return true;
    } else {
      // Still within the window, but count exceeds maxRequests
      this.auditLogger.logEvent('RATE_LIMIT_BLOCKED', { identifier, count: entry.count, maxRequests, windowSeconds }, undefined, identifier, 'FAILURE');
      return false;
    }
  }

  /**
   * Clears all rate limit entries.
   */
  public clearAll(): void {
    const count = this.store.size;
    this.store.clear();
    this.auditLogger.logSystemActivity('All rate limit entries cleared', { clearedEntries: count });
  }

  /**
   * Manually resets the rate limit for a specific identifier.
   * @param identifier The identifier to reset.
   */
  public resetIdentifier(identifier: string): boolean {
    if (this.store.has(identifier)) {
      this.store.delete(identifier);
      this.auditLogger.logSystemActivity('Rate limit reset for identifier', { identifier });
      return true;
    }
    return false;
  }

  /**
   * Gets the current state of an identifier for debugging or testing.
   * @param identifier
   * @returns The RateLimitEntry or undefined.
   */
  public getIdentifierState(identifier: string): RateLimitEntry | undefined {
      return this.store.get(identifier);
  }
}
