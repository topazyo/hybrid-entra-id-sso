// src/services/RateLimiter.test.ts
import { RateLimiter, InMemoryRateLimitStore, RateLimitEntry } from './RateLimiter'; // Import InMemoryRateLimitStore & RateLimitEntry
import { AuditLogger, LogProvider } from './AuditLogger';

// Mock LogProvider as before
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

describe('RateLimiter with InMemoryRateLimitStore', () => {
  let rateLimiter: RateLimiter;
  let mockLogProvider: MockLogProvider;
  let inMemoryStore: InMemoryRateLimitStore;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;

  const testIdentifier = 'test-ip-127.0.0.1';
  const maxRequests = 3;
  const windowSeconds = 5; // 5 seconds

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');

    // Instantiate InMemoryRateLimitStore, it also uses an AuditLogger internally for its own events
    // We can pass the same mockLogProvider to it if we want to capture its logs too, or a different one.
    inMemoryStore = new InMemoryRateLimitStore(mockLogProvider);
    rateLimiter = new RateLimiter(inMemoryStore, mockLogProvider); // Pass store to RateLimiter
    jest.useFakeTimers();
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should initialize and log initialization from RateLimiter and InMemoryRateLimitStore', () => {
    expect(rateLimiter).toBeDefined();
    // Check RateLimiter's init log
    expect(logSystemActivitySpy).toHaveBeenCalledWith('RateLimiter initialized with a store');
    // Check InMemoryRateLimitStore's init log (assuming it's spied via prototype or same logger instance)
    expect(logSystemActivitySpy).toHaveBeenCalledWith('InMemoryRateLimitStore initialized');
  });

  describe('isAllowed (with InMemoryRateLimitStore using atomic increment)', () => {
    it('should allow requests below the limit', async () => {
      for (let i = 0; i < maxRequests; i++) {
        expect(await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true);
      }
      // Total calls to logEvent: 1 for NEW_IDENTIFIER_ATOMIC, (maxRequests - 1) for ALLOWED_ATOMIC
      expect(logEventSpy).toHaveBeenCalledTimes(maxRequests);
      expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_NEW_IDENTIFIER_ATOMIC',
        expect.objectContaining({ identifier: testIdentifier, count: 1 }),
        undefined, testIdentifier, 'INFO'
      );
      if (maxRequests > 1) {
        expect(logEventSpy).toHaveBeenLastCalledWith('RATE_LIMIT_ALLOWED_ATOMIC',
          expect.objectContaining({ identifier: testIdentifier, count: maxRequests }),
          undefined, testIdentifier, 'SUCCESS'
        );
      }
    });

    it('should block requests exceeding the limit and log _ATOMIC', async () => {
      for (let i = 0; i < maxRequests; i++) {
        await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
      }
      expect(await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(false);
      // The last successful log was count: maxRequests, then a BLOCKED log is issued
      // The count in the BLOCKED log should reflect the state *before* this attempt if not incremented, or current if incremented then checked
      // Based on InMemoryStore.increment, it returns currentCount which is maxRequests (not maxRequests+1) when blocked
      expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_BLOCKED_ATOMIC',
        expect.objectContaining({ identifier: testIdentifier, count: maxRequests }),
        undefined, testIdentifier, 'FAILURE'
      );
    });

    it('should reset and allow requests after the window expires (atomic path)', async () => {
      for (let i = 0; i < maxRequests; i++) {
        await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
      }
      expect(await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(false);

      jest.advanceTimersByTime(windowSeconds * 1000 + 100);

      expect(await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true);
      expect(logSystemActivitySpy).toHaveBeenCalledWith('InMemoryStore: Entry expired, resetting',
        expect.objectContaining({ identifier: testIdentifier })
      );
      // The last call to logEventSpy for this identifier should be NEW_IDENTIFIER_ATOMIC
      const callsForIdentifier = logEventSpy.mock.calls.filter(call => call[1].identifier === testIdentifier);
      expect(callsForIdentifier.pop()?.[0]).toBe('RATE_LIMIT_NEW_IDENTIFIER_ATOMIC');
    });

    it('should handle multiple identifiers independently (atomic path)', async () => {
        const id1 = 'ip1';
        const id2 = 'ip2';
        for (let i = 0; i < maxRequests; i++) {
            expect(await rateLimiter.isAllowed(id1, maxRequests, windowSeconds)).toBe(true);
            expect(await rateLimiter.isAllowed(id2, maxRequests, windowSeconds)).toBe(true);
        }
        expect(await rateLimiter.isAllowed(id1, maxRequests, windowSeconds)).toBe(false);
        expect(await rateLimiter.isAllowed(id2, maxRequests, windowSeconds)).toBe(false);

        jest.advanceTimersByTime(windowSeconds * 1000 + 100);

        expect(await rateLimiter.isAllowed(id1, maxRequests, windowSeconds)).toBe(true);
        expect(await rateLimiter.isAllowed(id2, maxRequests, windowSeconds)).toBe(true);
    });
  });

  describe('clearAll (with InMemoryRateLimitStore)', () => {
    it('should clear all rate limit entries via store', async () => {
        await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
        await rateLimiter.isAllowed('another-id', maxRequests, windowSeconds);

        await rateLimiter.clearAll();
        // Verify through store directly by trying to allow again (should be new)
        const storeStateAfterClear1 = await inMemoryStore.get(testIdentifier);
        expect(storeStateAfterClear1).toBeUndefined();
        const storeStateAfterClear2 = await inMemoryStore.get('another-id');
        expect(storeStateAfterClear2).toBeUndefined();

        expect(logSystemActivitySpy).toHaveBeenCalledWith('All rate limit entries cleared via store.clearAll()');
        expect(logSystemActivitySpy).toHaveBeenCalledWith('InMemoryRateLimitStore cleared', {clearedCount: 2});
    });
  });

  describe('resetIdentifier (with InMemoryRateLimitStore)', () => {
    it('should reset a specific identifier via store', async () => {
        for (let i = 0; i < maxRequests; i++) {
            await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
        }
        expect(await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(false);

        const wasReset = await rateLimiter.resetIdentifier(testIdentifier);
        expect(wasReset).toBe(true);
        expect(logSystemActivitySpy).toHaveBeenCalledWith('Rate limit reset for identifier via store.delete()', { identifier: testIdentifier });

        expect(await rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true); // Allowed again
    });

    it('resetIdentifier should return false if identifier not found in store', async () => {
        const wasReset = await rateLimiter.resetIdentifier('non-existent-id');
        expect(wasReset).toBe(false);
    });
  });

  // Test for RateLimiter's fallback (get-then-set) path
  describe('RateLimiter with a store without atomic increment', () => {
    let rateLimiterNoAtomic: RateLimiter;
    let simpleStore: InMemoryRateLimitStore; // Use InMemory but remove 'increment' for test

    beforeEach(() => {
        simpleStore = new InMemoryRateLimitStore(mockLogProvider);
        // Simulate a store without atomic increment
        (simpleStore as any).increment = undefined;
        rateLimiterNoAtomic = new RateLimiter(simpleStore, mockLogProvider);
    });

    it('should allow requests and log non-atomic events', async () => {
        expect(await rateLimiterNoAtomic.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true);
        expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_NEW_IDENTIFIER',
            expect.objectContaining({ identifier: testIdentifier, count: 1 }),
            undefined, testIdentifier, 'INFO'
        );

        expect(await rateLimiterNoAtomic.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true);
        expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_ALLOWED',
            expect.objectContaining({ identifier: testIdentifier, count: 2 }),
            undefined, testIdentifier, 'SUCCESS'
        );
    });

    it('should block requests and log non-atomic events', async () => {
        for (let i = 0; i < maxRequests; i++) {
            await rateLimiterNoAtomic.isAllowed(testIdentifier, maxRequests, windowSeconds);
        }
        expect(await rateLimiterNoAtomic.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(false);
        expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_BLOCKED',
            expect.objectContaining({ identifier: testIdentifier, count: maxRequests }),
            undefined, testIdentifier, 'FAILURE'
        );
    });
  });
});
