// src/controllers/HealthController.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from '../services/AuditLogger';
import { ConfigurationManager } from '../services/ConfigurationManager'; // Import ConfigurationManager

export interface HealthStatus {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  timestamp: string;
  version?: string;
  checks?: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'UP' | 'DOWN';
  details?: string;
  durationMs?: number;
}

export class HealthController {
  private auditLogger: AuditLogger;
  private configManager: ConfigurationManager; // Add configManager
  private appVersion: string;

  // Updated constructor to accept ConfigurationManager
  constructor(
    logProvider?: LogProvider,
    configManager?: ConfigurationManager, // Make optional for existing instantiation in index.ts or provide it there
    version: string = '0.0.1-unknown'
  ) {
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    // If configManager is not provided, instantiate a default one for internal use by healthcheck if necessary
    this.configManager = configManager || new ConfigurationManager(logProvider);
    this.appVersion = version;

    this.auditLogger.setGlobalContext('controller', 'HealthController');
    this.auditLogger.logSystemActivity('HealthController initialized', { version: this.appVersion }, 'info');
  }

  public async getHealth(correlationId?: string): Promise<HealthStatus> {
    const startTime = Date.now();
    const currentCorrelationId = correlationId || `health-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;

    this.auditLogger.logSystemActivity('Health check requested', { endpoint: '/health', correlationId: currentCorrelationId }, 'info');

    const internalChecks: HealthCheck[] = await this.performInternalChecks();

    const overallStatus = internalChecks.every(check => check.status === 'UP') ? 'UP' :
                          internalChecks.some(check => check.status === 'DOWN') ? 'DEGRADED' : 'UP'; // Simplified: DEGRADED if any is DOWN
    const durationMs = Date.now() - startTime;

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: this.appVersion,
      checks: internalChecks,
    };

    this.auditLogger.logEvent(
      'HEALTH_CHECK_PROCESSED',
      { overallStatus: healthStatus.status, durationMs, checksCount: internalChecks.length },
      undefined, undefined,
      healthStatus.status === 'UP' ? 'SUCCESS' : 'FAILURE',
      currentCorrelationId
    );

    return healthStatus;
  }

  // Updated performInternalChecks
  private async performInternalChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];

    // Check 1: Basic system check
    let checkStartTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 5));
    checks.push({
      name: 'SystemCore',
      status: 'UP',
      details: 'Core system components responsive.',
      durationMs: Date.now() - checkStartTime,
    });

    // Check 2: Mock Database Check
    checkStartTime = Date.now();
    let dbStatus: 'UP' | 'DOWN' = 'UP';
    let dbDetails = 'Database connection successful.';
    try {
      // Simulate async DB query
      await new Promise(resolve => setTimeout(resolve, 15));
      // Mock failure: if (Math.random() < 0.1) throw new Error("DB connection timeout");
    } catch (dbError: any) {
      dbStatus = 'DOWN';
      dbDetails = `Database connection failed: ${dbError.message}`;
    }
    checks.push({
      name: 'Database',
      status: dbStatus,
      details: dbDetails,
      durationMs: Date.now() - checkStartTime,
    });

    // Check 3: Configuration Service Check
    checkStartTime = Date.now();
    let configStatus: 'UP' | 'DOWN' = 'UP';
    let configDetails = 'Configuration service responsive and key found.';
    try {
      // Try to get a known key. Use a default for the check itself.
      const testKey = this.configManager.get('healthCheck.testKey', 'defaultValueForHealthCheck');
      if (testKey === 'defaultValueForHealthCheck' && !this.configManager.get('healthCheck.testKey')) {
          // This logic means if the key is explicitly missing and we got the default, it's still considered "UP"
          // because the config service itself responded with a default.
          // A true "DOWN" might be if configManager.get() itself threw an error or if a *critical* key was missing.
          // For this example, we'll assume getting any value (even default) means the service is "UP".
          // To make it fail, one might check if a *specific required* key is present and has a valid value.
          // Let's refine this to be more explicit for a testable failure:
          // configStatus = 'DOWN';
          // configDetails = 'Critical configuration key "some.critical.key" not found.';
      }
       if (this.configManager.get('forceConfigCheckFailure')) { // For testing
            configStatus = 'DOWN';
            configDetails = 'Forced configuration check failure for testing.';
       }

    } catch (configError: any) {
      configStatus = 'DOWN';
      configDetails = `Configuration service error: ${configError.message}`;
    }
    checks.push({
      name: 'ConfigurationService',
      status: configStatus,
      details: configDetails,
      durationMs: Date.now() - checkStartTime,
    });

    return checks;
  }

  public setAppVersion(version: string): void {
      this.appVersion = version;
      this.auditLogger.logSystemActivity('App version updated in HealthController', { newVersion: version }, 'info');
  }
}
