import { Logger } from '../utils/Logger';
import { RiskScoringEngine } from '../services/RiskScoringEngine';
import { AuditLogger } from '../services/AuditLogger';

interface PolicyRule {
  id: string;
  name: string;
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  riskThreshold: number;
  priority: number;
}

interface PolicyEvaluation {
  allowed: boolean;
  requiredControls: string[];
  riskScore: number;
  appliedRules: string[];
  explanation: string;
}

export class PolicyEnforcementEngine {
  private logger: Logger;
  private riskEngine: RiskScoringEngine;
  private auditLogger: AuditLogger;
  private policyRules: Map<string, PolicyRule>;

  constructor() {
    this.logger = new Logger('PolicyEnforcementEngine');
    this.riskEngine = new RiskScoringEngine();
    this.auditLogger = new AuditLogger(
      process.env.LOG_ANALYTICS_WORKSPACE_ID,
      process.env.LOG_ANALYTICS_KEY
    );
    this.initializePolicyRules();
  }

  private initializePolicyRules(): void {
    this.policyRules = new Map([
      ['high_risk_access', {
        id: 'POLICY_001',
        name: 'High Risk Access Control',
        conditions: [
          { type: 'risk_score', operator: 'gt', value: 0.7 }
        ],
        actions: [
          { type: 'require_mfa' },
          { type: 'require_manager_approval' }
        ],
        riskThreshold: 0.7,
        priority: 1
      }],
      ['off_hours_access', {
        id: 'POLICY_002',
        name: 'Off Hours Access Control',
        conditions: [
          { type: 'time_of_day', operator: 'outside', value: '0900-1700' }
        ],
        actions: [
          { type: 'require_justification' },
          { type: 'notify_manager' }
        ],
        riskThreshold: 0.5,
        priority: 2
      }]
    ]);
  }

  async evaluateAccess(context: AccessContext): Promise<PolicyEvaluation> {
    try {
      // Calculate risk score
      const riskScore = await this.riskEngine.calculateRiskScore({
        userId: context.userId,
        ipAddress: context.ipAddress,
        deviceId: context.deviceId,
        timestamp: context.timestamp,
        resourceId: context.resourceId,
        userTimezone: context.userTimezone
      });

      // Evaluate applicable policies
      const applicableRules = Array.from(this.policyRules.values())
        .filter(rule => this.isPolicyApplicable(rule, context, riskScore));

      // Sort by priority
      applicableRules.sort((a, b) => a.priority - b.priority);

      // Determine required controls
      const requiredControls = this.determineRequiredControls(
        applicableRules,
        riskScore
      );

      const evaluation: PolicyEvaluation = {
        allowed: this.determineAccessDecision(applicableRules, riskScore),
        requiredControls,
        riskScore: riskScore.total,
        appliedRules: applicableRules.map(rule => rule.id),
        explanation: this.generateExplanation(applicableRules, riskScore)
      };

      await this.logPolicyEvaluation(context, evaluation);
      return evaluation;
    } catch (error) {
      this.logger.error('Policy evaluation failed', { error });
      throw new PolicyEvaluationError('Failed to evaluate access policy', error);
    }
  }

  private isPolicyApplicable(
    rule: PolicyRule,
    context: AccessContext,
    riskScore: RiskScore
  ): boolean {
    return rule.conditions.every(condition => {
      switch (condition.type) {
        case 'risk_score':
          return this.evaluateRiskScoreCondition(condition, riskScore);
        case 'time_of_day':
          return this.evaluateTimeCondition(condition, context);
        default:
          return false;
      }
    });
  }

  private determineRequiredControls(
    rules: PolicyRule[],
    riskScore: RiskScore
  ): string[] {
    const controls = new Set<string>();

    rules.forEach(rule => {
      rule.actions.forEach(action => {
        if (action.type.startsWith('require_')) {
          controls.add(action.type);
        }
      });
    });

    // Add risk-based controls
    if (riskScore.total > 0.8) {
      controls.add('require_mfa');
      controls.add('require_device_compliance');
    }

    return Array.from(controls);
  }

  private async logPolicyEvaluation(
    context: AccessContext,
    evaluation: PolicyEvaluation
  ): Promise<void> {
    await this.auditLogger.logEvent({
      eventType: 'PolicyEvaluation',
      userId: context.userId,
      resourceId: context.resourceId,
      action: 'evaluate_policy',
      result: evaluation.allowed ? 'allowed' : 'denied',
      riskScore: evaluation.riskScore,
      metadata: {
        requiredControls: evaluation.requiredControls,
        appliedRules: evaluation.appliedRules,
        explanation: evaluation.explanation
      }
    });
  }
}