import { Gauge, Counter, Registry } from 'prom-client';
import { Logger } from '../../utils/Logger';

export class MetricsCollector {
  private registry: Registry;
  private logger: Logger;
  
  // Metrics definitions
  private authAttempts!: Counter<string>;
  private activeUsers!: Gauge<string>;
  private syncLatency!: Gauge<string>;
  private mainframeLatency!: Gauge<string>;
  private failedAuthentications!: Counter<string>;

  constructor() {
    this.registry = new Registry();
    this.logger = new Logger('MetricsCollector');
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    this.authAttempts = new Counter({
      name: 'sso_auth_attempts_total',
      help: 'Total number of authentication attempts',
      labelNames: ['status', 'auth_type'],
      registers: [this.registry]
    });

    this.activeUsers = new Gauge({
      name: 'sso_active_users',
      help: 'Number of currently active users',
      labelNames: ['system'],
      registers: [this.registry]
    });

    this.syncLatency = new Gauge({
      name: 'sso_sync_latency_seconds',
      help: 'Identity synchronization latency in seconds',
      registers: [this.registry]
    });

    this.mainframeLatency = new Gauge({
      name: 'sso_mainframe_latency_seconds',
      help: 'Mainframe connection latency in seconds',
      registers: [this.registry]
    });

    this.failedAuthentications = new Counter({
      name: 'sso_failed_authentications_total',
      help: 'Total number of failed authentication attempts',
      labelNames: ['reason'],
      registers: [this.registry]
    });
  }

  async recordAuthAttempt(status: string, type: string): Promise<void> {
    this.authAttempts.labels(status, type).inc();
  }

  async updateActiveUsers(system: string, count: number): Promise<void> {
    this.activeUsers.labels(system).set(count);
  }

  async recordSyncLatency(latencyMs: number): Promise<void> {
    this.syncLatency.set(latencyMs / 1000);
  }

  /** Record a generic metric by name with optional labels and value (defaults to 1). */
  async recordMetric(name: string, value: number, labels?: Record<string, string | number>): Promise<void> {
    const metric = this.registry.getSingleMetric(name);
    if (!metric) {
      this.logger.warn('Attempted to record unknown metric', { name, labels, value });
      return;
    }

    try {
      // Support counters and gauges; default inc for counters, set for gauges.
      if ('inc' in metric) {
        (metric as any).inc(labels as any, value);
      } else if ('set' in metric) {
        (metric as any).set(labels as any, value);
      } else {
        this.logger.warn('Metric type unsupported for recordMetric', { name });
      }
    } catch (error) {
      this.logger.error('Failed to record metric', { name, labels, value, error });
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}