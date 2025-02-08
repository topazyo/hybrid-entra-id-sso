import { Logger } from '../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { EventBus } from '../utils/EventBus';

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

export class RealTimeAlertManager {
  private logger: Logger;
  private metrics: MetricsCollector;
  private eventBus: EventBus;
  private alertRules: Map<string, AlertRule>;
  private activeAlerts: Map<string, Alert>;

  constructor() {
    this.logger = new Logger('RealTimeAlertManager');
    this.metrics = new MetricsCollector();
    this.eventBus = new EventBus();
    this.alertRules = new Map();
    this.activeAlerts = new Map();
    this.initializeAlertRules();
  }

  private initializeAlertRules(): void {
    this.alertRules.set('failed_auth', {
      id: 'ALERT_001',
      name: 'Failed Authentication Spike',
      severity: 'high',
      conditions: [{
        metric: 'auth.failures',
        operator: 'gt',
        value: 5
      }],
      threshold: 5,
      timeWindow: 300000, // 5 minutes
      actions: ['notify_security_team', 'block_source_ip']
    });

    this.alertRules.set('sync_failure', {
      id: 'ALERT_002',
      name: 'Identity Sync Failure',
      severity: 'critical',
      conditions: [{
        metric: 'sync.failures',
        operator: 'gt',
        value: 0
      }],
      threshold: 1,
      timeWindow: 600000, // 10 minutes
      actions: ['notify_admin', 'trigger_backup_sync']
    });
  }

  async processMetricUpdate(metric: string, value: number): Promise<void> {
    try {
      const applicableRules = this.findApplicableRules(metric);
      
      for (const rule of applicableRules) {
        const isTriggered = await this.evaluateRule(rule, metric, value);
        
        if (isTriggered) {
          await this.triggerAlert(rule, metric, value);
        }
      }
    } catch (error) {
      this.logger.error('Failed to process metric update', { metric, value, error });
      throw error;
    }
  }

  private findApplicableRules(metric: string): AlertRule[] {
    return Array.from(this.alertRules.values())
      .filter(rule => rule.conditions.some(c => c.metric === metric));
  }

  private async evaluateRule(
    rule: AlertRule,
    metric: string,
    value: number
  ): Promise<boolean> {
    try {
      const condition = rule.conditions.find(c => c.metric === metric);
      if (!condition) return false;

      const historicalData = await this.getHistoricalData(metric, rule.timeWindow);
      const isThresholdExceeded = this.checkThreshold(value, condition);
      const isAnomalous = this.detectAnomaly(value, historicalData);

      return isThresholdExceeded && isAnomalous;
    } catch (error) {
      this.logger.error('Rule evaluation failed', { rule, metric, value, error });
      return false;
    }
  }

  private async triggerAlert(
    rule: AlertRule,
    metric: string,
    value: number
  ): Promise<void> {
    const alertId = `${rule.id}_${Date.now()}`;
    
    const alert: Alert = {
      id: alertId,
      ruleId: rule.id,
      severity: rule.severity,
      metric,
      value,
      timestamp: new Date(),
      status: 'active'
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

  private async executeAction(action: string, alert: Alert): Promise<void> {
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
    this.activeAlerts.delete(aler