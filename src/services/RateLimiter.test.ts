// src/services/RateLimiter.test.ts
import { RateLimiter } from './RateLimiter';
import { AuditLogger, LogProvider } from './AuditLogger';

class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockLogProvider: MockLogProvider;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;

  const testIdentifier = 'test-ip-127.0.0.1';
  const maxRequests = 3;
  const windowSeconds = 5; // 5 seconds

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');

    rateLimiter = new RateLimiter(mockLogProvider);
    jest.useFakeTimers();
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should initialize and log initialization', () => {
    expect(rateLimiter).toBeDefined();
    expect(logSystemActivitySpy).toHaveBeenCalledWith('RateLimiter initialized');
  });

  describe('isAllowed', () => {
    it('should allow requests below the limit', () => {
      for (let i = 0; i < maxRequests; i++) {
        expect(rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true);
      }
      expect(logEventSpy).toHaveBeenCalledTimes(maxRequests);
      expect(logEventSpy).toHaveBeenLastCalledWith('RATE_LIMIT_ALLOWED',
        expect.objectContaining({ identifier: testIdentifier, count: maxRequests }),
        undefined, testIdentifier, 'SUCCESS'
      );
    });

    it('should correctly log a new identifier on its first request', () => {
        rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
        expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_NEW_IDENTIFIER',
            expect.objectContaining({ identifier: testIdentifier, count: 1 }),
            undefined, testIdentifier, 'INFO'
        );
    });

    it('should block requests exceeding the limit within the window', () => {
      for (let i = 0; i < maxRequests; i++) {
        rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
      }
      // Next request should be blocked
      expect(rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(false);
      expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_BLOCKED',
        expect.objectContaining({ identifier: testIdentifier, count: maxRequests }), // Count is maxRequests when blocked
        undefined, testIdentifier, 'FAILURE'
      );
    });

    it('should reset and allow requests after the window expires', () => {
      for (let i = 0; i < maxRequests; i++) {
        rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
      }
      // Block one more
      expect(rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(false);

      // Advance time beyond the window
      jest.advanceTimersByTime(windowSeconds * 1000 + 100);

      // Now it should be allowed again, and it's a new window
      expect(rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true);
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Rate limit window expired, resetting count',
        expect.objectContaining({ identifier: testIdentifier })
      );
      expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_NEW_IDENTIFIER', // Logged as new after reset
        expect.objectContaining({ identifier: testIdentifier, count: 1 }),
        undefined, testIdentifier, 'INFO'
      );
    });

    it('should handle multiple identifiers independently', () => {
      const id1 = 'ip1';
      const id2 = 'ip2';
      for (let i = 0; i < maxRequests; i++) {
        expect(rateLimiter.isAllowed(id1, maxRequests, windowSeconds)).toBe(true);
        expect(rateLimiter.isAllowed(id2, maxRequests, windowSeconds)).toBe(true);
      }
      expect(rateLimiter.isAllowed(id1, maxRequests, windowSeconds)).toBe(false); // id1 blocked
      expect(rateLimiter.isAllowed(id2, maxRequests, windowSeconds)).toBe(false); // id2 blocked

      jest.advanceTimersByTime(windowSeconds * 1000 + 100);

      expect(rateLimiter.isAllowed(id1, maxRequests, windowSeconds)).toBe(true); // id1 allowed again
      expect(rateLimiter.isAllowed(id2, maxRequests, windowSeconds)).toBe(true); // id2 allowed again
    });
  });

  describe('clearAll', () => {
    it('should clear all rate limit entries', () => {
        rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
        rateLimiter.isAllowed('another-id', maxRequests, windowSeconds);
        expect(rateLimiter.getIdentifierState(testIdentifier)).toBeDefined();

        rateLimiter.clearAll();
        expect(rateLimiter.getIdentifierState(testIdentifier)).toBeUndefined();
        expect(rateLimiter.getIdentifierState('another-id')).toBeUndefined();
        expect(logSystemActivitySpy).toHaveBeenCalledWith('All rate limit entries cleared', { clearedEntries: 2 });
    });
  });

  describe('resetIdentifier', () => {
    it('should reset a specific identifier, allowing requests again', () => {
        for (let i = 0; i < maxRequests; i++) {
            rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds);
        }
        expect(rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(false); // Blocked

        const wasReset = rateLimiter.resetIdentifier(testIdentifier);
        expect(wasReset).toBe(true);
        expect(logSystemActivitySpy).toHaveBeenCalledWith('Rate limit reset for identifier', { identifier: testIdentifier });

        expect(rateLimiter.isAllowed(testIdentifier, maxRequests, windowSeconds)).toBe(true); // Allowed again
        expect(logEventSpy).toHaveBeenCalledWith('RATE_LIMIT_NEW_IDENTIFIER',
            expect.objectContaining({ identifier: testIdentifier, count: 1 }),
            undefined, testIdentifier, 'INFO'
        );
    });

    it('resetIdentifier should return false if identifier not found', () => {
        const wasReset = rateLimiter.resetIdentifier('non-existent-id');
        expect(wasReset).toBe(false);
    });
  });
});
