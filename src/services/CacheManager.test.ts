// src/services/CacheManager.test.ts
import { CacheManager } from './CacheManager';
import { AuditLogger, LogProvider } from './AuditLogger';

class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  let mockLogProvider: MockLogProvider;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    // Spy on AuditLogger.prototype methods before CacheManager instantiation
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');

    cacheManager = new CacheManager(mockLogProvider, 60); // Default 60s TTL for tests
    jest.useFakeTimers(); // Use Jest fake timers for TTL tests
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
    jest.clearAllTimers();
    jest.useRealTimers(); // Restore real timers
  });

  it('should initialize and log initialization', () => {
    expect(cacheManager).toBeDefined();
    expect(logSystemActivitySpy).toHaveBeenCalledWith('CacheManager initialized', { defaultTTLSeconds: 60 });
  });

  describe('set/get', () => {
    it('should set a value and get it back', () => {
      cacheManager.set('myKey', 'myValue');
      expect(cacheManager.get('myKey')).toBe('myValue');
      expect(logEventSpy).toHaveBeenCalledWith('CACHE_SET', expect.objectContaining({ key: 'myKey' }), undefined, undefined, 'SUCCESS');
      expect(logEventSpy).toHaveBeenCalledWith('CACHE_HIT', { key: 'myKey' }, undefined, undefined, 'SUCCESS');
    });

    it('should return undefined for a non-existent key and log miss', () => {
      expect(cacheManager.get('nonExistent')).toBeUndefined();
      expect(logEventSpy).toHaveBeenCalledWith('CACHE_MISS', { key: 'nonExistent' }, undefined, undefined, 'INFO');
    });
  });

  describe('TTL functionality', () => {
    it('should expire a key after its TTL', () => {
      cacheManager.set('timedKey', 'willExpire', 1); // 1 second TTL
      expect(cacheManager.get('timedKey')).toBe('willExpire');

      jest.advanceTimersByTime(1001); // Advance time by 1.001 seconds

      expect(cacheManager.get('timedKey')).toBeUndefined();
      expect(logEventSpy).toHaveBeenCalledWith('CACHE_MISS', { key: 'timedKey', reason: 'expired' }, undefined, undefined, 'INFO');
      // Check if system activity also logged removal (it should due to cleanupKeyIfExpired)
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Cache key expired and removed', { key: 'timedKey' });
    });

    it('should use default TTL if specific TTL is not provided or is invalid', () => {
      cacheManager.set('defaultTtlKey', 'someData'); // Uses default 60s
      jest.advanceTimersByTime(59 * 1000);
      expect(cacheManager.get('defaultTtlKey')).toBe('someData');

      jest.advanceTimersByTime(2 * 1000); // Total 61s
      expect(cacheManager.get('defaultTtlKey')).toBeUndefined();
    });

    it('set with 0 or negative TTL should use default TTL', () => {
        cacheManager.set('zeroTtlKey', 'data', 0);
        jest.advanceTimersByTime(59 * 1000);
        expect(cacheManager.get('zeroTtlKey')).toBe('data');
        jest.advanceTimersByTime(2 * 1000); // Total 61s (default TTL)
        expect(cacheManager.get('zeroTtlKey')).toBeUndefined();
    });
  });

  describe('del', () => {
    it('should delete a key and log deletion', () => {
      cacheManager.set('toDelete', 'data');
      expect(cacheManager.get('toDelete')).toBe('data');
      const deleted = cacheManager.del('toDelete');
      expect(deleted).toBe(true);
      expect(cacheManager.get('toDelete')).toBeUndefined();
      expect(logEventSpy).toHaveBeenCalledWith('CACHE_DELETE', { key: 'toDelete' }, undefined, undefined, 'SUCCESS');
    });

    it('should return false if deleting a non-existent key and log attempt', () => {
      const deleted = cacheManager.del('nonExistentDelete');
      expect(deleted).toBe(false);
      expect(logEventSpy).toHaveBeenCalledWith('CACHE_DELETE_ATTEMPT', { key: 'nonExistentDelete', found: false }, undefined, undefined, 'INFO');
    });
  });

  describe('clear', () => {
    it('should clear all keys from the cache and log clear event', () => {
      cacheManager.set('key1', 'val1');
      cacheManager.set('key2', 'val2');
      expect(cacheManager.count()).toBe(2);
      cacheManager.clear();
      expect(cacheManager.count()).toBe(0);
      expect(cacheManager.get('key1')).toBeUndefined();
      expect(logEventSpy).toHaveBeenCalledWith('CACHE_CLEAR', { clearedKeys: 2 }, undefined, undefined, 'SUCCESS');
    });
  });

  describe('has', () => {
    it('should return true for an existing, non-expired key', () => {
        cacheManager.set('hasKey', 'present');
        expect(cacheManager.has('hasKey')).toBe(true);
    });
    it('should return false for a non-existent key', () => {
        expect(cacheManager.has('noHasKey')).toBe(false);
    });
    it('should return false for an expired key and remove it', () => {
        cacheManager.set('expiredHasKey', 'going', 1); // 1s TTL
        jest.advanceTimersByTime(1001);
        expect(cacheManager.has('expiredHasKey')).toBe(false);
        expect(cacheManager.get('expiredHasKey')).toBeUndefined(); // Should be gone
        expect(logSystemActivitySpy).toHaveBeenCalledWith('Cache key expired and removed', { key: 'expiredHasKey' });
    });
  });

  describe('cleanupExpiredKeys (manual)', () => {
    it('should remove only expired keys and log if any removed', () => {
        cacheManager.set('keyA', 'activeA');
        cacheManager.set('keyB', 'expiringB', 1);
        cacheManager.set('keyC', 'activeC');
        cacheManager.set('keyD', 'expiringD', 2);

        jest.advanceTimersByTime(1001); // keyB expires

        const removedCount = cacheManager.cleanupExpiredKeys();
        expect(removedCount).toBe(1);
        expect(cacheManager.has('keyA')).toBe(true);
        expect(cacheManager.has('keyB')).toBe(false); // Should have been removed
        expect(cacheManager.has('keyC')).toBe(true);
        expect(cacheManager.has('keyD')).toBe(true); // Not yet expired
        expect(logSystemActivitySpy).toHaveBeenCalledWith(`Periodic cleanup removed 1 expired keys`, { removedCount: 1 });

        mockLogProvider.clearLogs(); // Clear for next check
        logSystemActivitySpy.mockClear();

        jest.advanceTimersByTime(1000); // keyD expires (total 2001ms)
        const removedCount2 = cacheManager.cleanupExpiredKeys();
        expect(removedCount2).toBe(1);
        expect(cacheManager.has('keyD')).toBe(false);
        expect(logSystemActivitySpy).toHaveBeenCalledWith(`Periodic cleanup removed 1 expired keys`, { removedCount: 1 });
    });

    it('should not log if no keys were removed by cleanup', () => {
        cacheManager.set('keyA', 'activeA');
        const removedCount = cacheManager.cleanupExpiredKeys();
        expect(removedCount).toBe(0);
        // Ensure the specific "Periodic cleanup removed..." log was NOT called
        // We check the spy directly for calls with the specific message content
        const periodicCleanupLogCall = logSystemActivitySpy.mock.calls.find(
            call => call[0]?.startsWith('Periodic cleanup removed')
        );
        expect(periodicCleanupLogCall).toBeUndefined();
    });
  });
});

describe('CacheManager with Size Limit and Eviction', () => {
  let cacheManagerWithLimit: CacheManager;
  let mockLogProviderForLimitTests: MockLogProvider;
  let logEventSpyForLimit: jest.SpyInstance;
  // let logSystemActivitySpyForLimit: jest.SpyInstance; // if needed

  const testMaxSize = 3;

  beforeEach(() => {
    mockLogProviderForLimitTests = new MockLogProvider();
    logEventSpyForLimit = jest.spyOn(AuditLogger.prototype, 'logEvent'); // Spy on prototype for this instance too
    // logSystemActivitySpyForLimit = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');

    // Pass maxSize to constructor
    cacheManagerWithLimit = new CacheManager(mockLogProviderForLimitTests, 60, testMaxSize);
    jest.useFakeTimers();
  });

  afterEach(() => {
    logEventSpyForLimit.mockRestore();
    // logSystemActivitySpyForLimit.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should initialize with given maxSize', () => {
    // logSystemActivitySpy was spied on AuditLogger.prototype, so it might pick up calls from other tests' beforeEach/afterEach
    // if not careful. For this test, we check the specific call from this instance's constructor.
    // For simplicity, this test relies on the constructor logging, which is already tested elsewhere.
    // The main point is that the CacheManager is configured with testMaxSize.
    // We can verify by filling it up.
    for (let i = 0; i < testMaxSize; i++) {
        cacheManagerWithLimit.set(`key${i}`, `value${i}`);
    }
    expect(cacheManagerWithLimit.count()).toBe(testMaxSize);
    // Adding one more should trigger eviction if maxSize is working
    cacheManagerWithLimit.set('newKey', 'newValue');
    expect(cacheManagerWithLimit.count()).toBe(testMaxSize); // Still at max size
  });

  it('should not exceed maxSize', () => {
    for (let i = 0; i < testMaxSize + 2; i++) { // Try to add more than maxSize
      cacheManagerWithLimit.set(`item${i}`, `data${i}`);
    }
    expect(cacheManagerWithLimit.count()).toBe(testMaxSize);
  });

  it('should evict the oldest item (FIFO) when maxSize is reached and a new key is added', () => {
    cacheManagerWithLimit.set('keyA', 'valA'); // Oldest
    cacheManagerWithLimit.set('keyB', 'valB');
    cacheManagerWithLimit.set('keyC', 'valC'); // Max size reached (3)
    expect(cacheManagerWithLimit.count()).toBe(3);

    // This new key should cause 'keyA' to be evicted
    cacheManagerWithLimit.set('keyD', 'valD');

    expect(cacheManagerWithLimit.count()).toBe(3);
    expect(cacheManagerWithLimit.get('keyA')).toBeUndefined(); // keyA should be gone
    expect(cacheManagerWithLimit.get('keyB')).toBe('valB');
    expect(cacheManagerWithLimit.get('keyC')).toBe('valC');
    expect(cacheManagerWithLimit.get('keyD')).toBe('valD'); // keyD should be present

    expect(logEventSpyForLimit).toHaveBeenCalledWith('CACHE_EVICTION_FIFO',
      expect.objectContaining({
        evictedKey: 'keyA',
        newKey: 'keyD',
        cacheSizeBeforeEviction: testMaxSize,
        maxCacheSize: testMaxSize
      }),
      undefined, undefined, 'INFO'
    );
  });

  it('should update an existing key without eviction when cache is full', () => {
    cacheManagerWithLimit.set('key1', 'val1');
    cacheManagerWithLimit.set('key2', 'val2');
    cacheManagerWithLimit.set('key3', 'val3'); // Cache is full (maxSize = 3)

    // Update key2
    cacheManagerWithLimit.set('key2', 'updatedVal2');

    expect(cacheManagerWithLimit.count()).toBe(3);
    expect(cacheManagerWithLimit.get('key1')).toBe('val1');
    expect(cacheManagerWithLimit.get('key2')).toBe('updatedVal2'); // Value updated
    expect(cacheManagerWithLimit.get('key3')).toBe('val3');

    // Check that no eviction event was logged for this update
    const evictionLog = mockLogProviderForLimitTests.logs.find(
        log => log.message === 'AuditEvent' && log.meta?.eventType === 'CACHE_EVICTION_FIFO'
    );
    expect(evictionLog).toBeUndefined();
  });

  it('should evict multiple items if multiple new items are added past maxSize', () => {
    cacheManagerWithLimit.set('a', 1);
    cacheManagerWithLimit.set('b', 2);
    cacheManagerWithLimit.set('c', 3); // Full: a, b, c

    cacheManagerWithLimit.set('d', 4); // Evicts 'a'. Cache: b, c, d
    expect(cacheManagerWithLimit.get('a')).toBeUndefined();
    expect(cacheManagerWithLimit.get('b')).toBe(2);
    expect(cacheManagerWithLimit.get('d')).toBe(4);
    expect(logEventSpyForLimit).toHaveBeenCalledWith('CACHE_EVICTION_FIFO', expect.objectContaining({ evictedKey: 'a', newKey: 'd' }), undefined, undefined, 'INFO');

    cacheManagerWithLimit.set('e', 5); // Evicts 'b'. Cache: c, d, e
    expect(cacheManagerWithLimit.get('b')).toBeUndefined();
    expect(cacheManagerWithLimit.get('c')).toBe(3);
    expect(cacheManagerWithLimit.get('e')).toBe(5);
    expect(logEventSpyForLimit).toHaveBeenCalledWith('CACHE_EVICTION_FIFO', expect.objectContaining({ evictedKey: 'b', newKey: 'e' }), undefined, undefined, 'INFO');

    expect(cacheManagerWithLimit.count()).toBe(testMaxSize);
  });
});