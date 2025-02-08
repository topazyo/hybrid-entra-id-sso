import { RiskEngine } from '../security/RiskEngine';
import { Logger } from '../utils/Logger';

export interface AccessPolicy {
  id: string;
  name: string;
  riskThreshold: number;
  requiredFactors: string[];
  allowedLocations?: string[];
  allowedDevices?: string[];
  timeRestrictions?: {
    start: string;
    end: string;
    timezone: string;
  };
}

export class PolicyEnforcer {
  private riskEngine: RiskEngine;
  private logger: Logger;

  constructor() {
    this.riskEngine = new RiskEngine();
    this.logger = new Logger('PolicyEnforcer');
  }

  async evaluateAccess(
    context: AccessContext,
    policy: AccessPolicy
  ): Promise<AccessDecision> {
    try {
      const riskScore = await this.riskEngine.evaluateRisk(context);
      
      if (riskScore.total > policy.riskThreshold) {
        return {
          granted: false,
          reason: 'Risk score exceeds threshold',
          requiredActions: this.determineRequiredActions(riskScore, policy)
        };
      }

      const locationAllowed = this.checkLocation(context, policy);
      const timeAllowed = this.checkTimeRestrictions(context, policy);
      const deviceAllowed = this.checkDevice(context, policy);

      if (!locationAllowed || !timeAllowed || !deviceAllowed) {
        return {
          granted: false,
          reason: 'Policy restrictions not met',
          requiredActions: ['contact_support']
        };
      }

      return {
        granted: true,
        conditions: this.determineConditions(riskScore, policy)
      };
    } catch (error) {
      this.logger.error('Policy evaluation failed', { error, context });
      throw new PolicyEvaluationError('Failed to evaluate access policy', error);
    }
  }

  private determineRequiredActions(
    riskScore: RiskScore,
    policy: AccessPolicy
  ): string[] {
    const actions = [];
    
    if (riskScore.factors.location > 0.7) {
      actions.push('verify_location');
    }
    if (riskScore.factors.device > 0.6) {
      actions.push('verify_device');
    }
    if (riskScore.total > policy.riskThreshold * 1.5) {
      actions.push('require_approval');
    }

    return actions;
  }
}