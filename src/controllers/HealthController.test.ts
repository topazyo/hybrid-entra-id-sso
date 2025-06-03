// src/controllers/HealthController.test.ts

import { HealthController, HealthStatus, HealthCheck } from './HealthController';
import { AuditLogger, LogProvider } from '../services/AuditLogger';

// Mock LogProvider for testing AuditLogger within HealthController
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

describe('HealthController', () => {
  let healthController: HealthController;
  let mockLogProvider: MockLogProvider;
  let auditLoggerSpy: AuditLogger; // To spy on the instance used by HealthController
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;
  let setGlobalContextSpy: jest.SpyInstance;

  const testAppVersion = '1.0.0-test';

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    // Instantiate HealthController, which internally creates AuditLogger with mockLogProvider
    // healthController = new HealthController(mockLogProvider, testAppVersion);

    // Access the AuditLogger instance created by HealthController to spy on it.
    // This is a bit of an indirect way; proper DI would make this cleaner.
    // For now, we assume HealthController uses the passed LogProvider for its AuditLogger.
    // We need to spy on the *actual* AuditLogger instance it uses.
    // A more robust way if AuditLogger wasn't exposed would be to mock the AuditLogger constructor.
    // Let's refine this: We will spy on the prototype of AuditLogger before HealthController is instantiated.

    // Reset spies for each test
    // Spies will be set up on AuditLogger.prototype before HealthController instantiation
    // to ensure the instance created *within* HealthController is spied upon.

    // Spy on AuditLogger methods that HealthController is expected to call
    // We need to ensure these spies are active when HealthController instantiates AuditLogger
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');
    setGlobalContextSpy = jest.spyOn(AuditLogger.prototype, 'setGlobalContext');

    // Now instantiate HealthController, it will use the spied AuditLogger prototype for its instance
    healthController = new HealthController(mockLogProvider, testAppVersion);


    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    // Restore all spied methods on AuditLogger.prototype
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    setGlobalContextSpy.mockRestore();

    mockLogProvider.clearLogs(); // Clear logs from the provider
    jest.useRealTimers();
  });

  it('should create an instance and log initialization', () => {
    expect(healthController).toBeDefined();
    // Constructor of HealthController calls logSystemActivity and setGlobalContext
    expect(setGlobalContextSpy).toHaveBeenCalledWith('controller', 'HealthController');
    expect(logSystemActivitySpy).toHaveBeenCalledWith(
      'HealthController initialized',
      { version: testAppVersion },
      'info'
    );
  });

  describe('getHealth', () => {
    it('should return UP status when all checks pass', async () => {
      const health = await healthController.getHealth('corr-up');
      expect(health.status).toBe('UP');
      expect(health.version).toBe(testAppVersion);
      expect(health.timestamp).toBe(new Date('2024-01-01T00:00:00.000Z').toISOString());
      expect(health.checks?.length).toBeGreaterThan(0);
      health.checks?.forEach(check => {
        expect(check.status).toBe('UP');
      });
    });

    it('should log system activity for request and event for processed health check (UP)', async () => {
      await healthController.getHealth('corr-log-up');

      expect(logSystemActivitySpy).toHaveBeenCalledWith(
        'Health check requested',
        { endpoint: '/health' },
        'info'
      );
      expect(logEventSpy).toHaveBeenCalledWith(
        'HEALTH_CHECK_PROCESSED',
        expect.objectContaining({ overallStatus: 'UP' }),
        undefined,
        undefined,
        'SUCCESS',
        'corr-log-up'
      );
    });

    it('should return DEGRADED status if any check fails', async () => {
      // Mock performInternalChecks to return a failing check
      const mockFailedCheck: HealthCheck = { name: 'CriticalDependency', status: 'DOWN', details: 'Failed hard' };
      jest.spyOn(healthController as any, 'performInternalChecks').mockResolvedValueOnce([
        { name: 'SystemCore', status: 'UP', details: 'OK' },
        mockFailedCheck
      ]);

      const health = await healthController.getHealth('corr-degraded');
      expect(health.status).toBe('DEGRADED');
      expect(health.checks).toContainEqual(mockFailedCheck);

      // Verify logging for DEGRADED status
      expect(logEventSpy).toHaveBeenCalledWith(
        'HEALTH_CHECK_PROCESSED',
        expect.objectContaining({ overallStatus: 'DEGRADED' }),
        undefined,
        undefined,
        'FAILURE', // DEGRADED maps to FAILURE for audit status
        'corr-degraded'
      );
    });

    it('should generate a correlationId if none is provided', async () => {
        await healthController.getHealth(); // No correlationId passed
        expect(logEventSpy).toHaveBeenCalledWith(
            'HEALTH_CHECK_PROCESSED',
            expect.anything(),
            undefined,
            undefined,
            expect.anything(),
            expect.stringMatching(/^health-\d{13}-\w{5,}$/) // Matches generated format
        );
    });

    it('should include durationMs for checks and processed event', async () => {
        const health = await healthController.getHealth('corr-duration');
        health.checks?.forEach(check => {
            expect(check.durationMs).toBeGreaterThanOrEqual(0);
        });
        expect(logEventSpy).toHaveBeenCalledWith(
            'HEALTH_CHECK_PROCESSED',
            expect.objectContaining({
                durationMs: expect.any(Number)
            }),
            undefined, undefined, 'SUCCESS', 'corr-duration'
        );
        const loggedDuration = (logEventSpy.mock.calls.find(call => call[0] === 'HEALTH_CHECK_PROCESSED')?.[1] as any)?.durationMs;
        expect(loggedDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setAppVersion', () => {
    it('should update appVersion and log the change', () => {
        const newVersion = "1.2.3-test";
        healthController.setAppVersion(newVersion);

        // Check if version is updated for subsequent health checks
        // Need to call getHealth again to see the new version in its output
        // However, we can directly check the logging of setAppVersion

        expect(logSystemActivitySpy).toHaveBeenCalledWith(
            'App version updated in HealthController',
            { newVersion: newVersion },
            'info'
        );

        // To fully test its effect, call getHealth again
        return healthController.getHealth('corr-version-update').then(health => {
            expect(health.version).toBe(newVersion);
        });
    });
  });

  it.todo('should handle errors during performInternalChecks gracefully');
});
