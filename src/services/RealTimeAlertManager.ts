import { Logger } from '../../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { EventBus } from '../../utils/EventBus';

interface AlertRule {
  id: string;
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  conditions: AlertCondition[];
  threshold: number;
  timeWindow: number;
  actions: AlertAction[];
}

interface AlertCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'neq';
  value: number;
}

type AlertAction = 'notify_security_team' | 'block_source_ip' | 'trigger_backup_sync';

interface AlertResolution {
  summary: string;
  actionTaken?: string;
  resolvedBy?: string;
}

interface Alert {
  id: string;
  ruleId: string;
  severity: AlertRule['severity'];
  metric: string;
  value: number;
  timestamp: Date;
  status: 'active' | 'resolved';
  metadata?: Record<string, any>;
  resolvedAt?: Date;
  resolution?: AlertResolution;
}

/**
 * Real-time alert evaluation and dispatch for metrics.
 */
export class RealTimeAlertManager {
  private logger: Logger;
  private metrics: MetricsCollector;
  private eventBus: EventBus;
  private alertRules: Map<string, AlertRule>;
  private activeAlerts: Map<string, Alert>;

  constructor(
    logger: Logger = new Logger('RealTimeAlertManager'),
    metrics: MetricsCollector = new MetricsCollector(),
    eventBus: EventBus = new EventBus()
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.eventBus = eventBus;
    this.alertRules = new Map();
    this.activeAlerts = new Map();
    this.initializeAlertRules();
  }

  private initializeAlertRules(): void {
    this.alertRules.set('failed_auth', {
      id: 'ALERT_001',
      name: 'Failed Authentication Spike',
      severity: 'high',
      conditions: [{ metric: 'auth.failures', operator: 'gt', value: 5 }],
      threshold: 5,
      timeWindow: 300000,
      actions: ['notify_security_team', 'block_source_ip']
    });

    this.alertRules.set('sync_failure', {
      id: 'ALERT_002',
      name: 'Identity Sync Failure',
      severity: 'critical',
      conditions: [{ metric: 'sync.failures', operator: 'gt', value: 0 }],
      threshold: 1,
      timeWindow: 600000,
      actions: ['notify_security_team', 'trigger_backup_sync']
    });
  }

  /** Evaluate incoming metric updates against alert rules. */
  async processMetricUpdate(metric: string, value: number, metadata?: Record<string, any>): Promise<void> {
    try {
      const applicableRules = this.findApplicableRules(metric);

      for (const rule of applicableRules) {
        const isTriggered = await this.evaluateRule(rule, metric, value, metadata);
        if (isTriggered) {
          await this.triggerAlert(rule, metric, value, metadata);
        }
      }
    } catch (error) {
      this.logger.error('Failed to process metric update', { metric, value, error });
      throw error;
    }
  }

  private findApplicableRules(metric: string): AlertRule[] {
    return Array.from(this.alertRules.values()).filter(rule =>
      rule.conditions.some(c => c.metric === metric)
    );
  }

  private async evaluateRule(
    rule: AlertRule,
    metric: string,
    value: number,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    try {
      const condition = rule.conditions.find(c => c.metric === metric);
      if (!condition) return false;

      const historicalData = await this.getHistoricalData(metric, rule.timeWindow);
      const isThresholdExceeded = this.checkThreshold(value, condition);
      const isAnomalous = this.detectAnomaly(value, historicalData, metadata);

      return isThresholdExceeded && isAnomalous;
    } catch (error) {
      this.logger.error('Rule evaluation failed', { rule, metric, value, error });
      return false;
    }
  }

  private async triggerAlert(
    rule: AlertRule,
    metric: string,
    value: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const alertId = `${rule.id}_${Date.now()}`;

    const alert: Alert = {
      id: alertId,
      ruleId: rule.id,
      severity: rule.severity,
      metric,
      value,
      timestamp: new Date(),
      status: 'active',
      metadata,
    };

    this.activeAlerts.set(alertId, alert);

    await this.executeAlertActions(rule, alert);
    await this.notifyAlertSubscribers(alert);
    await this.logAlert(alert);
  }

  private async executeAlertActions(rule: AlertRule, alert: Alert): Promise<void> {
    for (const action of rule.actions) {
      try {
        await this.executeAction(action, alert);
      } catch (error) {
        this.logger.error('Alert action execution failed', { action, alert, error });
      }
    }
  }

  private async notifyAlertSubscribers(alert: Alert): Promise<void> {
    await this.eventBus.publish('alert.new', alert);
  }

  private async executeAction(action: AlertAction, alert: Alert): Promise<void> {
    switch (action) {
      case 'notify_security_team':
        await this.notifySecurityTeam(alert);
        break;
      case 'block_source_ip':
        await this.blockSourceIP(alert);
        break;
      case 'trigger_backup_sync':
        await this.triggerBackupSync(alert);
        break;
      default:
        this.logger.warn('Unknown alert action', { action, alert });
    }
  }

  private async notifySecurityTeam(alert: Alert): Promise<void> {
    await this.eventBus.publish('security.alert', {
      type: 'security_alert',
      severity: alert.severity,
      message: `Security alert: ${alert.ruleId}`,
      details: alert
    });
  }

  private async blockSourceIP(alert: Alert): Promise<void> {
    if (alert.metadata?.sourceIP) {
      await this.eventBus.publish('security.block_ip', {
        ip: alert.metadata.sourceIP,
        reason: `Alert ${alert.id}`,
        timestamp: new Date()
      });
    }
  }

  private async triggerBackupSync(alert: Alert): Promise<void> {
    await this.eventBus.publish('sync.backup', {
      reason: `Alert ${alert.id}`,
      timestamp: new Date(),
      alert,
    });
  }

  private async logAlert(alert: Alert): Promise<void> {
    await this.metrics.recordMetric('alerts.triggered', 1, {
      severity: alert.severity,
      ruleId: alert.ruleId
    });

    this.logger.info('Alert triggered', { alert });
  }

  async resolveAlert(alertId: string, resolution: AlertResolution): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.status = 'resolved';
    alert.resolution = resolution;
    alert.resolvedAt = new Date();

    await this.logAlertResolution(alert);
    await this.eventBus.publish('alert.resolved', alert);
    this.activeAlerts.delete(alertId);
  }

  private async logAlertResolution(alert: Alert): Promise<void> {
    await this.metrics.recordMetric('alerts.resolved', 1, {
      severity: alert.severity,
      ruleId: alert.ruleId
    });
    this.logger.info('Alert resolved', { alert });
  }

  private async getHistoricalData(_metric: string, _windowMs: number): Promise<number[]> {
    return [];
  }

  private detectAnomaly(value: number, historical: number[], _metadata?: Record<string, any>): boolean {
    if (historical.length === 0) return true;
    const avg = historical.reduce((sum, v) => sum + v, 0) / historical.length;
    return value > avg;
  }

  private checkThreshold(value: number, condition: AlertCondition): boolean {
    switch (condition.operator) {
      case 'gt':
        return value > condition.value;
      case 'lt':
        return value < condition.value;
      case 'eq':
        return value === condition.value;
      case 'neq':
        return value !== condition.value;
      default:
        return false;
    }
  }
}
