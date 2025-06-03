// src/controllers/HealthController.ts

import { AuditLogger, LogProvider, ConsoleLogProvider } from '../services/AuditLogger'; // Assuming AuditLogger is in services

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
  private appVersion: string;

  constructor(logProvider?: LogProvider, version: string = '0.0.1-unknown') {
    // In a real app with dependency injection, AuditLogger might be injected.
    // Here, we instantiate it directly or via a provided LogProvider.
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.appVersion = version;

    this.auditLogger.setGlobalContext('controller', 'HealthController'); // Set controller-specific global context
    this.auditLogger.logSystemActivity('HealthController initialized', { version: this.appVersion }, 'info');
  }

  /**
   * Performs a basic health check of the application.
   * In a real application, this might check database connections, external services, etc.
   */
  public async getHealth(correlationId?: string): Promise<HealthStatus> {
    const startTime = Date.now();
    const currentCorrelationId = correlationId || `health-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;

    this.auditLogger.logSystemActivity(
      'Health check requested',
      { endpoint: '/health' },
      'info'
    );

    // Simulate some health checks
    const internalChecks: HealthCheck[] = await this.performInternalChecks();

    const overallStatus = internalChecks.every(check => check.status === 'UP') ? 'UP' : 'DEGRADED';
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
      undefined, // userId (health checks are typically unauthenticated)
      undefined, // clientIp
      healthStatus.status === 'UP' ? 'SUCCESS' : 'FAILURE', // Map UP to SUCCESS, others to FAILURE for audit status
      currentCorrelationId
    );

    return healthStatus;
  }

  private async performInternalChecks(): Promise<HealthCheck[]> {
    // Simulate asynchronous checks
    const checks: HealthCheck[] = [];

    // Check 1: Basic system check (always UP for this example)
    const systemCheckStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async work
    checks.push({
      name: 'SystemCore',
      status: 'UP',
      details: 'Core system components responsive.',
      durationMs: Date.now() - systemCheckStart,
    });

    // Check 2: Mock dependency check (can be made to fail for testing)
    const dependencyCheckStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, 20)); // Simulate async work
    const isDependencyUp = true; // Math.random() > 0.2; // Make it fail sometimes
    checks.push({
      name: 'MockExternalService',
      status: isDependencyUp ? 'UP' : 'DOWN',
      details: isDependencyUp ? 'Successfully connected.' : 'Failed to connect to service.',
      durationMs: Date.now() - dependencyCheckStart,
    });

    return checks;
  }

  /**
   * Allows updating the application version at runtime if necessary.
   * (Mainly for demonstration or specific scenarios)
   */
  public setAppVersion(version: string): void {
      this.appVersion = version;
      this.auditLogger.logSystemActivity('App version updated in HealthController', { newVersion: version }, 'info');
  }
}

// Example Usage (optional, for direct execution testing)
// if (require.main === module) {
//   const healthController = new HealthController();
//   healthController.getHealth().then(status => {
//     console.log("Health Status:", JSON.stringify(status, null, 2));
//   });
//   healthController.setGlobalContext('customField', 'customValue'); // Example of using AuditLogger's global context
//   healthController.getHealth("corr-test-123").then(status => {
//     console.log("Health Status (with correlation):", JSON.stringify(status, null, 2));
//   });
// }
