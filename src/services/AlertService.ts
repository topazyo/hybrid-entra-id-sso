import { Logger } from '../../utils/Logger';
import { EventBus } from '../../utils/EventBus';
import { MetricsCollector } from './MetricsCollector';
import { generateId } from '../../utils/IdGenerator';
import { Alert, AlertCreateInput } from '../types/alerts';

export class AlertService {
  private logger: Logger;
  private eventBus: EventBus;
  private metrics: MetricsCollector;
  private activeAlerts: Map<string, Alert>;
  private alertHandlers!: Map<string, AlertHandler>;

  constructor() {
    this.logger = new Logger('AlertService');
    this.eventBus = new EventBus();
    this.metrics = new MetricsCollector();
    this.activeAlerts = new Map();
    this.initializeAlertHandlers();
  }

  private initializeAlertHandlers(): void {
    this.alertHandlers = new Map([
      ['critical', new CriticalAlertHandler(this.logger, this.eventBus, this.metrics)],
      ['high', new HighAlertHandler(this.logger, this.eventBus, this.metrics)],
      ['medium', new MediumAlertHandler(this.logger, this.eventBus, this.metrics)],
      ['low', new LowAlertHandler(this.logger, this.eventBus, this.metrics)]
    ]);
  }

  async sendAlert(alertData: AlertCreateInput): Promise<string> {
    try {
      const alert: Alert = {
        ...alertData,
        id: generateId('alert'),
        timestamp: new Date(),
        status: 'new'
      };

      // Store alert
      this.activeAlerts.set(alert.id, alert);

      // Handle alert based on severity
      const handler = this.alertHandlers.get(alert.severity);
      if (handler) {
        await handler.handleAlert(alert);
      }

      // Publish alert event
      await this.eventBus.publish('alert.new', alert);

      // Record metrics
      await this.recordAlertMetrics(alert);

      // Log alert
      await this.logAlert(alert);

      return alert.id;
    } catch (error) {
      this.logger.error('Failed to send alert', { error, alertData });
      throw error;
    }
  }

  async acknowledgeAlert(alertId: string, userId: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.status = 'acknowledged';
    alert.acknowledgedBy = userId;

    await this.eventBus.publish('alert.acknowledged', alert);
    await this.logAlertUpdate(alert, 'acknowledged');
  }

  async resolveAlert(
    alertId: string,
    userId: string,
    resolution: string
  ): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.status = 'resolved';
    alert.resolvedBy = userId;
    alert.resolution = resolution;

    this.activeAlerts.delete(alertId);

    await this.eventBus.publish('alert.resolved', alert);
    await this.logAlertUpdate(alert, 'resolved');
  }

  private async recordAlertMetrics(alert: Alert): Promise<void> {
    await this.metrics.recordMetric('alerts.created', 1, {
      severity: alert.severity,
      component: alert.component
    });
  }

  private async logAlert(alert: Alert): Promise<void> {
    await this.logger.info('New alert created', {
      alertId: alert.id,
      severity: alert.severity,
      component: alert.component,
      message: alert.message
    });
  }

  private async logAlertUpdate(alert: Alert, action: string): Promise<void> {
    await this.logger.info(`Alert ${action}`, {
      alertId: alert.id,
      severity: alert.severity,
      component: alert.component,
      status: alert.status,
      updatedBy: alert.acknowledgedBy || alert.resolvedBy
    });
  }

  async getActiveAlerts(): Promise<Alert[]> {
    return Array.from(this.activeAlerts.values());
  }

  async getAlertsByComponent(component: string): Promise<Alert[]> {
    return Array.from(this.activeAlerts.values())
      .filter(alert => alert.component === component);
  }
}

interface AlertHandler {
  handleAlert(alert: Alert): Promise<void>;
}

class BaseAlertHandler {
  protected logger: Logger;
  protected eventBus: EventBus;
  protected metrics: MetricsCollector;

  constructor(logger: Logger, eventBus: EventBus, metrics: MetricsCollector) {
    this.logger = logger;
    this.eventBus = eventBus;
    this.metrics = metrics;
  }

  protected async record(severity: Alert['severity'], alert: Alert): Promise<void> {
    await this.metrics.recordMetric(`alerts.${severity}`, 1, { component: alert.component });
  }
}

class CriticalAlertHandler extends BaseAlertHandler implements AlertHandler {
  async handleAlert(alert: Alert): Promise<void> {
    await this.record('critical', alert);
    await this.eventBus.publish('alert.critical', alert);
    await this.logger.warn('Critical alert dispatched', { alertId: alert.id, component: alert.component });
  }
}

class HighAlertHandler extends BaseAlertHandler implements AlertHandler {
  async handleAlert(alert: Alert): Promise<void> {
    await this.record('high', alert);
    await this.eventBus.publish('alert.high', alert);
    await this.logger.warn('High alert dispatched', { alertId: alert.id, component: alert.component });
  }
}

class MediumAlertHandler extends BaseAlertHandler implements AlertHandler {
  async handleAlert(alert: Alert): Promise<void> {
    await this.record('medium', alert);
    await this.eventBus.publish('alert.medium', alert);
    await this.logger.info('Medium alert handled', { alertId: alert.id, component: alert.component });
  }
}

class LowAlertHandler extends BaseAlertHandler implements AlertHandler {
  async handleAlert(alert: Alert): Promise<void> {
    await this.record('low', alert);
    await this.eventBus.publish('alert.low', alert);
    await this.logger.info('Low alert handled', { alertId: alert.id, component: alert.component });
  }
}