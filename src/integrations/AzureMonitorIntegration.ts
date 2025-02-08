import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../services/MetricsCollector';
import { AzureMonitorClient } from '@azure/monitor-query';
import { DefaultAzureCredential } from '@azure/identity';

interface MonitoringConfig {
  workspaceId: string;
  resourceGroup: string;
  subscriptionId: string;
  metricNamespace: string;
}

export class AzureMonitorIntegration {
  private logger: Logger;
  private client: AzureMonitorClient;
  private metrics: MetricsCollector;
  private config: MonitoringConfig;

  constructor(config: MonitoringConfig) {
    this.logger = new Logger('AzureMonitorIntegration');
    this.config = config;
    this.metrics = new MetricsCollector();
    this.initializeClient();
  }

  private async initializeClient(): Promise<void> {
    try {
      const credential = new DefaultAzureCredential();
      this.client = new AzureMonitorClient(credential);
    } catch (error) {
      this.logger.error('Failed to initialize Azure Monitor client', { error });
      throw error;
    }
  }

  async querySecurityEvents(timeRange: { start: Date; end: Date }): Promise<any[]> {
    const query = `
      SecurityEvent
      | where TimeGenerated between(datetime('${timeRange.start.toISOString()}')..datetime('${timeRange.end.toISOString()}'))
      | where EventID in (4624, 4625, 4634, 4648)
      | project TimeGenerated, EventID, Account, Computer, IpAddress, LogonType
      | sort by TimeGenerated desc
    `;

    try {
      const result = await this.client.queryWorkspace(
        this.config.workspaceId,
        query,
        { timespan: { duration: 'PT24H' } }
      );

      await this.processQueryResults(result);
      return result.rows;
    } catch (error) {
      this.logger.error('Failed to query security events', { error, timeRange });
      throw error;
    }
  }

  async sendCustomMetrics(metrics: Record<string, number>): Promise<void> {
    try {
      const timestamp = new Date();
      const metricRequests = Object.entries(metrics).map(([name, value]) => ({
        name,
        value,
        timestamp,
        namespace: this.config.metricNamespace
      }));

      await Promise.all(
        metricRequests.map(metric =>
          this.client.sendMetric(metric)
        )
      );

      this.logger.debug('Successfully sent custom metrics', { metrics });
    } catch (error) {
      this.logger.error('Failed to send custom metrics', { error, metrics });
      throw error;
    }
  }

  private async processQueryResults(results: any): Promise<void> {
    // Process and analyze query results
    const metrics = this.analyzeQueryResults(results);
    await this.metrics.recordMetrics(metrics);
  }

  private analyzeQueryResults(results: any): Record<string, number> {
    return {
      totalEvents: results.rows.length,
      failedLogins: results.rows.filter(r => r[1] === 4625).length,
      successfulLogins: results.rows.filter(r => r[1] === 4624).length,
      averageEventsPerHour: results.rows.length / 24
    };
  }
}