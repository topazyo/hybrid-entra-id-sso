import { Logger } from '../utils/Logger';
import { AlertService } from './AlertService';
import { AuditLogger } from './AuditLogger';
import { EventBus } from '../utils/EventBus';

interface RemediationAction {
  id: string;
  type: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  steps: RemediationStep[];
  rollbackSteps?: RemediationStep[];
  timeout: number;
}

export class RemediationService {
  private logger: Logger;
  private alertService: AlertService;
  private auditLogger: AuditLogger;
  private eventBus: EventBus;
  private activeRemediations: Map<string, RemediationStatus>;

  constructor() {
    this.logger = new Logger('RemediationService');
    this.alertService = new AlertService();
    this.auditLogger = new AuditLogger(
      process.env.LOG_ANALYTICS_WORKSPACE_ID,
      process.env.LOG_ANALYTICS_KEY
    );
    this.eventBus = new EventBus();
    this.activeRemediations = new Map();
  }

  async handleIncident(incident: SecurityIncident): Promise<RemediationResult> {
    try {
      const remediationPlan = await this.createRemediationPlan(incident);
      const remediationId = await this.initiateRemediation(remediationPlan);

      await this.monitorRemediation(remediationId);
      return await this.getRemediationResult(remediationId);
    } catch (error) {
      this.logger.error('Remediation failed', { incident, error });
      throw new RemediationError('Failed to handle incident', error);
    }
  }

  private async createRemediationPlan(
    incident: SecurityIncident
  ): Promise<RemediationAction[]> {
    const actions: RemediationAction[] = [];

    switch (incident.type) {
      case 'unauthorized_access':
        actions.push(await this.createAccessRevocationAction(incident));
        actions.push(await this.createAuditTrailAction(incident));
        break;
      case 'suspicious_activity':
        actions.push(await this.createAccountLockAction(incident));
        actions.push(await this.createInvestigationAction(incident));
        break;
      case 'compliance_violation':
        actions.push(await this.createComplianceAction(incident));
        break;
    }

    return actions;
  }

  private async executeRemediationStep(
    step: RemediationStep,
    context: RemediationContext
  ): Promise<StepResult> {
    try {
      await this.validatePreConditions(step, context);
      const result = await this.executeStep(step, context);
      await this.validatePostConditions(step, context, result);

      return result;
    } catch (error) {
      await this.handleStepFailure(step, context, error);
      throw error;
    }
  }

  private async rollbackRemediation(
    remediationId: string,
    error: Error
  ): Promise<void> {
    const remediation = this.activeRemediations.get(remediationId);
    if (!remediation) return;

    try {
      for (const step of remediation.completedSteps.reverse()) {
        await this.executeRollbackStep(step, remediation.context);
      }
    } catch (rollbackError) {
      this.logger.error('Rollback failed', { remediationId, rollbackError });
      await this.alertService.sendAlert({
        severity: 'critical',
        component: 'Remediation',
        message: 'Remediation rollback failed',
        details: { remediationId, error, rollbackError }
      });
    }
  }
}