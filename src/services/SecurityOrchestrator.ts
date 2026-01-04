import { Logger } from '../../utils/Logger';
import { EventBus } from '../../utils/EventBus';

export interface SecurityIncident {
  id: string;
  type: string;
  severity: string;
  timestamp: Date;
  source: string;
  context?: Record<string, any>;
}

export interface SecurityResponse {
  status: 'completed' | 'error';
  riskScore?: number;
  actionsExecuted?: string[];
  error?: string;
}

type MinimalLogger = Pick<Logger, 'info' | 'warn' | 'error'>;

export class SecurityOrchestrator {
  private logger: MinimalLogger;
  private eventBus: EventBus;
  private activeActions: Map<string, string>;

  constructor(logger?: MinimalLogger, eventBus?: EventBus) {
    this.logger = logger || new Logger('SecurityOrchestrator');
    this.eventBus = eventBus || new EventBus();
    this.activeActions = new Map();
    this.initializeEventHandlers();
  }

  private initializeEventHandlers(): void {
    this.eventBus.subscribe('security.threat', (event) => this.logger.info('Threat event received', event));
    this.eventBus.subscribe('security.incident', (event) => this.logger.warn('Incident event received', event));
    this.eventBus.subscribe('security.alert', (event) => this.logger.warn('Alert event received', event));
  }

  async orchestrateResponse(incident: SecurityIncident): Promise<SecurityResponse> {
    const allowedTypes = ['unauthorized_access', 'data_exfiltration', 'suspicious_activity'];
    if (!allowedTypes.includes(incident.type)) {
      this.logger.error('Unsupported incident type', { incident });
      throw new Error('Invalid incident type');
    }

    try {
      const riskScore = this.estimateRisk(incident);
      const actions = this.determineActions(incident, riskScore);

      actions.forEach((action) => this.activeActions.set(action, incident.id));
      await this.executeActions(actions, incident);

      this.logger.info('Security orchestration completed', { incidentId: incident.id, actions });
      return { status: 'completed', riskScore, actionsExecuted: actions };
    } catch (error: any) {
      this.logger.error('Security orchestration failed', { incident, error: error?.message });
      throw error;
    }
  }

  private estimateRisk(incident: SecurityIncident): number {
    // Simple heuristic for now; replace with RiskEngine integration later.
    const severityMap: Record<string, number> = { low: 0.2, medium: 0.5, high: 0.8, critical: 0.95 };
    return severityMap[incident.severity?.toLowerCase()] ?? 0.4;
  }

  private determineActions(incident: SecurityIncident, riskScore: number): string[] {
    const actions: string[] = [];
    if (riskScore >= 0.8) {
      actions.push('block_source', 'notify_security', 'open_investigation');
    } else if (riskScore >= 0.5) {
      actions.push('increase_monitoring', 'notify_security');
    } else {
      actions.push('log_and_monitor');
    }
    if (incident.type === 'unauthorized_access') {
      actions.push('force_password_reset');
    }
    return actions;
  }

  private async executeActions(actions: string[], incident: SecurityIncident): Promise<void> {
    for (const action of actions) {
      try {
        await this.logger.info(`Executing action ${action}`, { incidentId: incident.id });
      } catch (error) {
        await this.logger.error(`Action ${action} failed`, { incidentId: incident.id, error });
        throw error;
      }
    }
  }
}