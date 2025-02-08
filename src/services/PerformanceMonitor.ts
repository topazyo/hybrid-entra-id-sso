import { Logger } from '../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { AlertService } from './AlertService';

interface PerformanceMetrics {
  responseTime: number;
  throughput: number;
  errorRate: number;
  resourceUtilization: ResourceMetrics;
  timestamp: Date;
}

export class PerformanceMonitor {
  private logger: Logger;
  private metrics: MetricsCollector;
  private alertService: AlertService;
  private thresholds: PerformanceThresholds;

  constructor() {
    this.logger = new Logger('PerformanceMonitor');
    this.metrics = new MetricsCollector();
    this.alertService = new AlertService();
    this.loadThresholds();
  }

  async monitorPerformance(): Promise<PerformanceMetrics> {
    try {
      const metrics = await this.collectPerformanceMetrics();
      await this.analyzePerformance(metrics);
      await this.storeMetrics(metrics);

      return metrics;
    } catch (error) {
      this.logger.error('Performance monitoring failed', { error });
      throw new PerformanceMonitoringError('Failed to monitor performance', error);
    }
  }

  private async collectPerformanceMetrics(): Promise<PerformanceMetrics> {
    const [responseTime, throughput, errorRate, resources] = await Promise.all([
      this.measureResponseTime(),
      this.measureThroughput(),
      this.calculateErrorRate(),
      this.collectResourceMetrics()
    ]);

    return {
      responseTime,
      throughput,
      errorRate,
      resourceUtilization: resources,
      timestamp: new Date()
    };
  }

  private async analyzePerformance(metrics: PerformanceMetrics): Promise<void> {
    const violations = this.checkThresholdViolations(metrics);
    
    if (violations.length > 0) {
      await this.handlePerformanceIssues(violations, metrics);
    }
  }

  private checkThresholdViolations(
    metrics: PerformanceMetrics
  ): ThresholdViolation[] {
    const violations: ThresholdViolation[] = [];

    if (metrics.responseTime > this.thresholds.maxResponseTime) {
      violations.push({
        metric: 'responseTime',
        value: metrics.responseTime,
        threshold: this.thresholds.maxResponseTime
      });
    }

    // Add more threshold checks

    return violations;
  }

  private async handlePerformanceIssues(
    violations: ThresholdViolation[],
    metrics: PerformanceMetrics
  ): Promise<void> {
    await this.alertService.sendAlert({
      severity: this.determineSeverity(violations),
      component: 'Performance',
      message: 'Performance threshold violations detected',
      details: { violations, metrics }
    });
  }
}