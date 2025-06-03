// src/controllers/HealthController.test.ts
import { HealthController, HealthStatus, HealthCheck } from './HealthController';
import { AuditLogger, LogProvider } from '../services/AuditLogger';
import { ConfigurationManager } from '../services/ConfigurationManager'; // Import

// Mock LogProvider as before
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
  let mockConfigManager: ConfigurationManager;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;
  let setGlobalContextSpy: jest.SpyInstance;

  const testAppVersion = '1.0.0-test';

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    // Provide a real ConfigurationManager instance, can also be a mock if complex interactions are needed
    mockConfigManager = new ConfigurationManager(mockLogProvider);
    mockConfigManager.set('healthCheck.testKey', 'testValue'); // Setup for health check
    mockConfigManager.set('appVersion', testAppVersion); // Assuming HealthController might get version from here or passed

    // Spies on AuditLogger.prototype
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');
    setGlobalContextSpy = jest.spyOn(AuditLogger.prototype, 'setGlobalContext');

    // Pass the mockConfigManager to HealthController
    healthController = new HealthController(mockLogProvider, mockConfigManager, testAppVersion);

    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    setGlobalContextSpy.mockRestore();
    mockLogProvider.clearLogs();
    jest.useRealTimers();
  });

  it('should create an instance and log initialization', () => {
    expect(healthController).toBeDefined();
    expect(setGlobalContextSpy).toHaveBeenCalledWith('controller', 'HealthController');
    expect(logSystemActivitySpy).toHaveBeenCalledWith(
      'HealthController initialized',
      { version: testAppVersion },
      'info'
    );
  });

  describe('getHealth', () => {
    it('should return UP status with Database and ConfigurationService checks when all pass', async () => {
      const health = await healthController.getHealth('corr-up-detailed');
      expect(health.status).toBe('UP');
      expect(health.checks).toBeInstanceOf(Array);
      expect(health.checks?.length).toBe(3); // SystemCore, Database, ConfigurationService

      const dbCheck = health.checks?.find(c => c.name === 'Database');
      expect(dbCheck).toBeDefined();
      expect(dbCheck?.status).toBe('UP');

      const configCheck = health.checks?.find(c => c.name === 'ConfigurationService');
      expect(configCheck).toBeDefined();
      expect(configCheck?.status).toBe('UP');
      expect(configCheck?.details).toBe('Configuration service responsive and key found.');
    });

    it('should return DEGRADED if Database check fails (mocked scenario by spying on performInternalChecks)', async () => {
      const mockChecks: HealthCheck[] = [
        { name: 'SystemCore', status: 'UP', durationMs: 5 },
        { name: 'Database', status: 'DOWN', details: 'Mocked DB failure', durationMs: 10 },
        { name: 'ConfigurationService', status: 'UP', durationMs: 2 },
      ];
      const performChecksSpy = jest.spyOn(healthController as any, 'performInternalChecks').mockResolvedValueOnce(mockChecks);

      const health = await healthController.getHealth('corr-degraded-db');
      expect(health.status).toBe('DEGRADED');
      const dbCheck = health.checks?.find(c => c.name === 'Database');
      expect(dbCheck?.status).toBe('DOWN');

      performChecksSpy.mockRestore();
    });

    it('should return DEGRADED if ConfigurationService check is forced to fail via config', async () => {
        // Set the config flag that HealthController's performInternalChecks uses to simulate failure
        mockConfigManager.set('forceConfigCheckFailure', true);
        // Re-instantiate or ensure controller picks up this config.
        // Since configManager is passed by reference, it should pick it up if get is called during performInternalChecks.
        // No, HealthController has its own instance of configManager if not provided, or uses the one provided.
        // The current setup in beforeEach provides mockConfigManager, so this set should be visible.

        const health = await healthController.getHealth('corr-degraded-config-forced');
        expect(health.status).toBe('DEGRADED');
        const configCheck = health.checks?.find(c => c.name === 'ConfigurationService');
        expect(configCheck?.status).toBe('DOWN');
        expect(configCheck?.details).toBe('Forced configuration check failure for testing.');

        // Clean up the flag from config for other tests
        mockConfigManager.set('forceConfigCheckFailure', undefined);
    });

    it('should log system activity for request and event for processed health check (UP)', async () => {
      await healthController.getHealth('corr-log-up-detailed');

      expect(logSystemActivitySpy).toHaveBeenCalledWith(
        'Health check requested',
        expect.objectContaining({ endpoint: '/health', correlationId: 'corr-log-up-detailed' }),
        'info'
      );
      expect(logEventSpy).toHaveBeenCalledWith(
        'HEALTH_CHECK_PROCESSED',
        expect.objectContaining({ overallStatus: 'UP', checksCount: 3 }), // Now 3 checks
        undefined,
        undefined,
        'SUCCESS',
        'corr-log-up-detailed'
      );
    });

    it('should generate a correlationId if none is provided', async () => {
        await healthController.getHealth();
        expect(logEventSpy).toHaveBeenCalledWith(
            'HEALTH_CHECK_PROCESSED',
            expect.anything(),
            undefined,
            undefined,
            expect.anything(),
            expect.stringMatching(/^health-\d{13}-\w{5,}$/)
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
                durationMs: expect.any(Number),
                checksCount: 3 // Ensure this reflects the new number of checks
            }),
            undefined, undefined, 'SUCCESS', 'corr-duration'
        );
        const loggedCall = logEventSpy.mock.calls.find(call => call[0] === 'HEALTH_CHECK_PROCESSED');
        const loggedDuration = loggedCall?.[1]?.durationMs;
        expect(loggedDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setAppVersion', () => {
    it('should update appVersion and log the change', async () => { // Made async for the getHealth call
        const newVersion = "1.2.3-test";
        healthController.setAppVersion(newVersion);

        expect(logSystemActivitySpy).toHaveBeenCalledWith(
            'App version updated in HealthController',
            { newVersion: newVersion },
            'info'
        );

        const health = await healthController.getHealth('corr-version-update');
        expect(health.version).toBe(newVersion);
    });
  });

  it.todo('should handle errors during performInternalChecks gracefully if a check throws an unexpected error');
});
