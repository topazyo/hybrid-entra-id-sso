import { Logger } from '../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { AlertService } from './AlertService';

interface IntegrationHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  metrics: {
    latency: number;
    errorRate: number;
    availability: number;
  };
  issues: HealthIssue[];
}

export class IntegrationHealthMonitor {
  private logger: Logger;
  private metrics: MetricsCollector;
  private alertService: AlertService;
  private healthCache: Map<string, IntegrationHealth>;

  constructor() {
    this.logger = new Logger('IntegrationHealthMonitor');
    this.metrics = new MetricsCollector();
    this.alertService = new AlertService();
    this.healthCache = new Map();
  }

  async checkIntegrationHealth(integrationId: string): Promise<IntegrationHealth> {
    try {
      const [connectivity, performance, errors] = await Promise.all([
        this.checkConnectivity(integrationId),
        this.checkPerformance(integrationId),
        this.checkErrors(integrationId)
      ]);

      const health: IntegrationHealth = {
        status: this.determineStatus(connectivity, performance, errors),
        lastCheck: new Date(),
        metrics: {
          latency: performance.latency,
          errorRate: errors.rate,
          availability: connectivity.availability
        },
        issues: this.identifyIssues(connectivity, performance, errors)
      };

      await this.updateHealthStatus(integrationId, health);
      return health;
    } catch (error) {
      this.logger.error('Health check failed', { integrationId, error });
      throw new HealthCheckError('Failed to check integration health', error);
    }
  }

  private async checkConnectivity(integrationId: string): Promise<ConnectivityStatus> {
    // Implement connectivity check logic
    return {
      available: true,
      availability: 99.9,
      lastSuccess: new Date()
    };
  }

  private async updateHealthStatus(
    integrationId: string,
    health: IntegrationHealth
  ): Promise<void> {
    this.healthCache.set(integrationId, health);

    if (health.status !== 'healthy') {
      await this.alertService.sendAlert({
        severity: health.status === 'unhealthy' ? 'high' : 'medium',
        component: integrationId,
        message: `Integration health status: ${health.status}`,
        details: health
      });
    }

    await this.metrics.recordIntegrationHealth(integrationId, health);
  }
}