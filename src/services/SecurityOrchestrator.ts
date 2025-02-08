import { Logger } from '../utils/Logger';
import { EventBus } from '../utils/EventBus';
import { RiskEngine } from '../security/RiskEngine';
import { AlertService } from './AlertService';

interface SecurityAction {
  type: string;
  priority: number;
  target: string;
  parameters: Record<string, any>;
  timeout: number;
}

export class SecurityOrchestrator {
  private logger: Logger;
  private eventBus: EventBus;
  private riskEngine: RiskEngine;
  private alertService: AlertService;
  private activeActions: Map<string, SecurityAction>;

  constructor() {
    this.logger = new Logger('SecurityOrchestrator');
    this.eventBus = new EventBus();
    this.riskEngine = new RiskEngine();
    this.alertService = new AlertService();
    this.activeActions = new Map();
    this.initializeEventHandlers();
  }

  private initializeEventHandlers(): void {
    this.eventBus.subscribe('security.threat', this.handleThreatEvent.bind(this));
    this.eventBus.subscribe('security.incident', this.handleSecurityIncident.bind(this));
    this.eventBus.subscribe('security.alert', this.handleSecurityAlert.bind(this));
  }

  async orchestrateResponse(incident: SecurityIncident): Promise<void> {
    try {
      const riskScore = await this.riskEngine.evaluateRisk(incident.context);
      const actions = await this.determineActions(incident, riskScore);

      await this.executeActionChain(actions);
      await this.monitorActionResults(actions);
      await this.validateSecurityState();
    } catch (error) {
      this.logger.error('Security orchestration failed', { incident, error });
      throw new OrchestrationError('Failed to orchestrate security response', error);
    }
  }

  private async determineActions(
    incident: SecurityIncident,
    riskScore: number
  ): Promise<SecurityAction[]> {
    const actions: SecurityAction[] = [];

    if (riskScore > 0.8) {
      actions.push(await this.createBlockingAction(incident));
      actions.push(await this.createInvestigationAction(incident));
    } else if (riskScore > 0.5) {
      actions.push(await this.createMonitoringAction(incident));
      actions.push(await this.createAlertAction(incident));
    }

    return this.prioritizeActions(actions);
  }

  private async executeActionChain(actions: SecurityAction[]): Promise<void> {
    for (const action of actions) {
      try {
        await this.executeAction(action);
      } catch (error) {
        await this.handleActionFailure(action, error);
        if (this.isActionCritical(action)) {
          throw error;
        }
      }
    }
  }

  private async handleThreatEvent(event: SecurityEvent): Promise<void> {
    const threatContext = await this.buildThreatContext(event);
    const response = await this.createThreatResponse(threatContext);
    await this.orchestrateResponse(response);
  }
}