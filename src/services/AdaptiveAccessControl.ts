import { Logger } from '../utils/Logger';
import { RiskEngine } from '../security/RiskEngine';
import { BehavioralAnalytics } from './BehavioralAnalytics';
import { DeviceTrustService } from './DeviceTrustService';

interface AccessContext {
  userId: string;
  resourceId: string;
  deviceId: string;
  ipAddress: string;
  timestamp: Date;
  requestedPermissions: string[];
}

export class AdaptiveAccessControl {
  private logger: Logger;
  private riskEngine: RiskEngine;
  private behavioralAnalytics: BehavioralAnalytics;
  private deviceTrust: DeviceTrustService;

  constructor() {
    this.logger = new Logger('AdaptiveAccessControl');
    this.riskEngine = new RiskEngine();
    this.behavioralAnalytics = new BehavioralAnalytics();
    this.deviceTrust = new DeviceTrustService();
  }

  async evaluateAccess(context: AccessContext): Promise<AccessDecision> {
    try {
      const [
        riskScore,
        behaviorScore,
        deviceTrustLevel
      ] = await Promise.all([
        this.riskEngine.evaluateRisk(context),
        this.behavioralAnalytics.analyzeUserBehavior(context),
        this.deviceTrust.evaluateDevice(context.deviceId)
      ]);

      const decision = await this.makeAccessDecision(
        context,
        { riskScore, behaviorScore, deviceTrustLevel }
      );

      await this.enforceDecision(decision, context);
      await this.logDecision(decision, context);

      return decision;
    } catch (error) {
      this.logger.error('Access evaluation failed', { context, error });
      throw new AccessControlError('Failed to evaluate access', error);
    }
  }

  private async makeAccessDecision(
    context: AccessContext,
    scores: {
      riskScore: number;
      behaviorScore: number;
      deviceTrustLevel: number;
    }
  ): Promise<AccessDecision> {
    const baselineAccess = await this.determineBaselineAccess(context);
    const adaptiveControls = await this.determineAdaptiveControls(context, scores);
    
    return {
      granted: this.shouldGrantAccess(baselineAccess, scores),
      requiredControls: adaptiveControls,
      expirationTime: this.calculateAccessDuration(scores),
      restrictions: this.determineRestrictions(scores)
    };
  }

  private async determineAdaptiveControls(
    context: AccessContext,
    scores: any
  ): Promise<string[]> {
    const controls: string[] = [];

    if (scores.riskScore > 0.6) {
      controls.push('mfa_required');
    }
    if (scores.deviceTrustLevel < 0.5) {
      controls.push('device_compliance_required');
    }
    if (scores.behaviorScore < 0.7) {
      controls.push('session_monitoring');
    }

    return controls;
  }

  private calculateAccessDuration(scores: any): Date {
    const baseTime = 4 * 60 * 60 * 1000; // 4 hours
    const riskMultiplier = Math.max(0.2, 1 - scores.riskScore);
    return new Date(Date.now() + baseTime * riskMultiplier);
  }
}