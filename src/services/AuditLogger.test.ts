// src/services/AuditLogger.test.ts

// Import the actual AuditLogger and related interfaces
import { AuditLogger, LogProvider, AuditLogEvent, SystemActivityLog, ConsoleLogProvider } from './AuditLogger';

// Mock LogProvider for testing - this can remain as it's a test utility
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];

  info(message: string, meta?: any): void {
    this.logs.push({ level: 'info', message, meta });
  }
  warn(message: string, meta?: any): void {
    this.logs.push({ level: 'warn', message, meta });
  }
  error(message: string, meta?: any): void {
    this.logs.push({ level: 'error', message, meta });
  }
  debug(message: string, meta?: any): void { // Added debug to match interface
    this.logs.push({ level: 'debug', message, meta });
  }
  clearLogs(): void {
    this.logs = [];
  }
}

describe('AuditLogger Basic Functionality', () => {
  let mockLogProvider: MockLogProvider;
  let auditLogger: AuditLogger; // Will now be the real AuditLogger

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    auditLogger = new AuditLogger(mockLogProvider); // Instantiate real AuditLogger with mock provider
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    mockLogProvider.clearLogs(); // Clear logs from the mock provider
    jest.useRealTimers();
  });

  it('should create an instance using MockLogProvider', () => {
    expect(auditLogger).toBeDefined();
  });

  it('logEvent should log a structured event with all provided fields', () => {
    const eventDetails = { data: 'sample data', operation: 'create' };
    auditLogger.logEvent(
      'USER_LOGIN',
      eventDetails,
      'user123',
      '192.168.1.1',
      'SUCCESS',
      'corr-id-123'
    );

    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.level).toBe('info');
    expect(log.message).toBe('AuditEvent');
    // Note: The structure of log.meta will now be exactly what AuditLogger produces
    expect(log.meta).toEqual({
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      eventType: 'USER_LOGIN',
      eventDetails: { data: 'sample data', operation: 'create' }, // Global context not set yet
      userId: 'user123',
      clientIp: '192.168.1.1',
      status: 'SUCCESS',
      correlationId: 'corr-id-123',
    });
  });

  it('logEvent should handle optional fields correctly and default status to INFO', () => {
    auditLogger.logEvent('SYSTEM_STARTUP', { module: 'core' });

    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.message).toBe('AuditEvent');
    expect(log.meta).toEqual({
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      eventType: 'SYSTEM_STARTUP',
      eventDetails: { module: 'core' }, // Global context not set yet
      userId: undefined,
      clientIp: undefined,
      status: 'INFO', // Default status
      correlationId: undefined,
    });
  });

  it('logEvent should use current timestamp', () => {
    const specificTime = new Date('2024-03-15T10:30:00.000Z');
    jest.setSystemTime(specificTime);
    auditLogger.logEvent('TEST_EVENT', {});
    expect(mockLogProvider.logs[0].meta.timestamp).toEqual(specificTime);
  });

  it('logSystemActivity should log info messages correctly', () => {
    auditLogger.logSystemActivity("System startup complete", { modulesLoaded: 5 }, 'info');
    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.level).toBe('info');
    expect(log.message).toBe('SystemActivity');
    expect(log.meta).toEqual({
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        message: "System startup complete",
        details: { modulesLoaded: 5 } // Global context not set yet
    });
  });

  it('logSystemActivity should log warning messages correctly', () => {
    auditLogger.logSystemActivity("Low disk space", { freeSpace: "100MB" }, 'warn');
    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.level).toBe('warn');
    expect(log.message).toBe('SystemActivity');
     expect(log.meta).toEqual({
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        message: "Low disk space",
        details: { freeSpace: "100MB" } // Global context not set yet
    });
  });

  it('logSystemActivity should log error messages correctly', () => {
    auditLogger.logSystemActivity("Database connection failed", { errorCode: "DB500" }, 'error');
    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.level).toBe('error');
    expect(log.message).toBe('SystemActivity');
    expect(log.meta).toEqual({
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        message: "Database connection failed",
        details: { errorCode: "DB500" } // Global context not set yet
    });
  });

  it('logSystemActivity should default to info level if not specified', () => {
    auditLogger.logSystemActivity("Routine check done", { checkId: "R789" });
    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.level).toBe('info');
    expect(log.message).toBe('SystemActivity');
    expect(log.meta.details).toEqual({ checkId: "R789" }); // Global context not set
  });

  it('logSystemActivity should use debug level and fallback if provider does not have debug', () => {
    auditLogger.logSystemActivity("Debugging issue", { traceId: "trace-001" }, 'debug');
    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.level).toBe('debug'); // MockLogProvider has debug
    expect(log.message).toBe('SystemActivity');
    expect(log.meta.details).toEqual({ traceId: "trace-001" });

    // Test fallback if provider doesn't have debug
    const simpleProvider = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const loggerWithSimpleProvider = new AuditLogger(simpleProvider);
    loggerWithSimpleProvider.logSystemActivity("Debugging with simple provider", {}, 'debug');
    expect(simpleProvider.info).toHaveBeenCalledWith('SystemActivity [DEBUG]', expect.anything());
  });


  it.todo('should handle different types of eventDetails (e.g., strings, numbers, complex objects)');
  it.todo('should integrate with a more sophisticated logging library if provided');
  it.todo('should have a mechanism for filtering or sampling logs if it becomes a feature');
});


describe('AuditLogger with Global Context', () => {
  let mockLogProvider: MockLogProvider;
  let auditLogger: AuditLogger; // Real AuditLogger

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    auditLogger = new AuditLogger(mockLogProvider);
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    mockLogProvider.clearLogs();
    jest.useRealTimers();
  });

  it('setGlobalContext should add a field that appears in logEvent details', () => {
    auditLogger.setGlobalContext('appName', 'MySSOApp');
    auditLogger.logEvent('USER_ACTION', { action: 'view_page' });

    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.meta.eventDetails).toEqual({ // eventDetails is now the merged object
      appName: 'MySSOApp',
      action: 'view_page',
    });
  });

  it('setGlobalContext should add a field that appears in logSystemActivity details', () => {
    auditLogger.setGlobalContext('appVersion', '1.0.2');
    auditLogger.logSystemActivity('SERVICE_START', { serviceName: 'auth_service' });

    expect(mockLogProvider.logs.length).toBe(1);
    const log = mockLogProvider.logs[0];
    expect(log.meta.details).toEqual({ // details is now the merged object
        appVersion: '1.0.2',
        serviceName: 'auth_service',
    });
  });

  it('setGlobalContext should update an existing global context field', () => {
    auditLogger.setGlobalContext('environment', 'staging');
    auditLogger.setGlobalContext('environment', 'production');
    auditLogger.logEvent('CONFIG_LOADED', { configSource: 'file' });

    expect(mockLogProvider.logs[0].meta.eventDetails).toEqual({
      environment: 'production',
      configSource: 'file',
    });
  });

  it('clearGlobalContext should remove a field, and it should not appear in logs', () => {
    auditLogger.setGlobalContext('sessionId', 'session123');
    auditLogger.setGlobalContext('tenantId', 'tenant-abc');
    auditLogger.clearGlobalContext('sessionId');
    auditLogger.logEvent('USER_LOGOUT', { userId: 'u1' });

    expect(mockLogProvider.logs[0].meta.eventDetails).toEqual({
      tenantId: 'tenant-abc',
      userId: 'u1', // This is part of eventDetails, not a top-level field in the meta.eventDetails itself
    });
    expect(mockLogProvider.logs[0].meta.eventDetails.sessionId).toBeUndefined();
  });

  it('getGlobalContext should return a copy of the current global context', () => {
    auditLogger.setGlobalContext('key1', 'value1');
    auditLogger.setGlobalContext('key2', 'value2');
    const context = auditLogger.getGlobalContext();
    expect(context).toEqual({ key1: 'value1', key2: 'value2' });
    // Ensure it's a copy
    context.key1 = 'changed';
    expect(auditLogger.getGlobalContext().key1).toBe('value1');
  });

  it('event-specific details should override global context fields with the same name in logEvent', () => {
    auditLogger.setGlobalContext('status', 'GLOBAL_PENDING'); // This 'status' is a custom field in globalContext
    auditLogger.setGlobalContext('appName', 'MySSOApp');
    // The 'status' parameter of logEvent is for the fixed AuditLogEvent.status field
    auditLogger.logEvent('REQUEST_PROCESS', { status: 'EVENT_SUCCESS', data: 'payload' }, undefined, undefined, 'SUCCESS');

    const logMeta = mockLogProvider.logs[0].meta;
    expect(logMeta.status).toBe('SUCCESS'); // This is the fixed field from logEvent parameter
    expect(logMeta.eventDetails).toEqual({ // eventDetails contains merged context
      appName: 'MySSOApp',
      status: 'EVENT_SUCCESS', // Event specific 'status' in details overrides global 'status' in details
      data: 'payload',
    });
  });

  it('event-specific details should override global context fields with the same name in logSystemActivity', () => {
    auditLogger.setGlobalContext('source', 'GLOBAL_SYSTEM');
    auditLogger.setGlobalContext('module', 'CoreModule');
    auditLogger.logSystemActivity("Processing data", { source: 'SpecificTask', items: 5 });

    expect(mockLogProvider.logs[0].meta.details).toEqual({
      module: 'CoreModule',
      source: 'SpecificTask', // Event specific 'source' in details overrides global 'source' in details
      items: 5
    });
  });

  it('multiple global context fields should be included in logs', () => {
    auditLogger.setGlobalContext('datacenter', 'dc-west-1');
    auditLogger.setGlobalContext('clusterId', 'cluster-007');
    auditLogger.logEvent('NODE_HEALTH_CHECK', { node: 'node-a1' });

    expect(mockLogProvider.logs[0].meta.eventDetails).toEqual({
      datacenter: 'dc-west-1',
      clusterId: 'cluster-007',
      node: 'node-a1',
    });
  });
});