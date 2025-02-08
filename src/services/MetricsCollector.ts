import { Gauge, Counter, Registry } from 'prom-client';
import { Logger } from '../utils/Logger';

export class MetricsCollector {
  private registry: Registry;
  private logger: Logger;
  
  // Metrics definitions
  private authAttempts: Counter;
  private activeUsers: Gauge;
  private syncLatency: Gauge;
  private mainframeLatency: Gauge;
  private failedAuthentications: Counter;

  constructor() {
    this.registry = new Registry();
    this.logger = new Logger('MetricsCollector');
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    this.authAttempts = new Counter({
      name: 'sso_auth_attempts_total',
      help: 'Total number of authentication attempts',
      labelNames: ['status', 'auth_type']
    });

    this.activeUsers = new Gauge({
      name: 'sso_active_users',
      help: 'Number of currently active users',
      labelNames: ['system']
    });

    this.syncLatency = new Gauge({
      name: 'sso_sync_latency_seconds',
      help: 'Identity synchronization latency in seconds'
    });

    this.mainframeLatency = new Gauge({
      name: 'sso_mainframe_latency_seconds',
      help: 'Mainframe connection latency in seconds'
    });

    this.failedAuthentications = new Counter({
      name: 'sso_failed_authentications_total',
      help: 'Total number of failed authentication attempts',
      labelNames: ['reason']
    });

    // Register metrics
    [
      this.authAttempts,
      this.activeUsers,
      this.syncLatency,
      this.mainframeLatency,
      this.failedAuthentications
    ].forEach(metric => this.registry.registerMetric(metric));
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

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}