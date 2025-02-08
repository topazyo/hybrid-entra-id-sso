import { MonitoringConfig } from '../../src/types/config';
import { AzureMonitor } from '../services/AzureMonitor';
import { AlertService } from '../services/AlertService';

export class IdentityMonitor {
  private config: MonitoringConfig;
  private azureMonitor: AzureMonitor;
  private alertService: AlertService;

  constructor(config: MonitoringConfig) {
    this.config = config;
    this.azureMonitor = new AzureMonitor(config);
    this.alertService = new AlertService();
  }

  async monitorSyncHealth(): Promise<void> {
    try {
      const metrics = await this.collectSyncMetrics();
      await this.analyzeSyncHealth(metrics);
      await this.logMetrics(metrics);
    } catch (error) {
      await this.handleMonitoringError(error);
    }
  }

  private async collectSyncMetrics(): Promise<SyncMetrics> {
    return {
      lastSyncTime: new Date(),
      failedExports: await this.getFailedExports(),
      identityMismatches: await this.getIdentityMismatches(),
      syncLatency: await this.measureSyncLatency()
    };
  }

  private async analyzeSyncHealth(metrics: SyncMetrics): Promise<void> {
    if (metrics.failedExports > this.config.alertThresholds.failedExports) {
      await this.alertService.raiseAlert({
        severity: 'High',
        component: 'Identity Sync',
        message: `High number of failed exports: ${metrics.failedExports}`
      });
    }
  }
}