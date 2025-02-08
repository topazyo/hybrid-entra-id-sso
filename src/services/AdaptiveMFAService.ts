import { Logger } from '../utils/Logger';
import { RiskEngine } from '../security/RiskEngine';
import { UserContextService } from './UserContextService';

interface MFAContext {
  userId: string;
  deviceId: string;
  ipAddress: string;
  resource: string;
  timestamp: Date;
  riskScore?: number;
}

export class AdaptiveMFAService {
  private logger: Logger;
  private riskEngine: RiskEngine;
  private userContext: UserContextService;

  constructor() {
    this.logger = new Logger('AdaptiveMFAService');
    this.riskEngine = new RiskEngine();
    this.userContext = new UserContextService();
  }

  async determineMFARequirement(context: MFAContext): Promise<MFADecision> {
    try {
      const [riskScore, userBehavior, deviceTrust] = await Promise.all([
        context.riskScore || this.riskEngine.evaluateRisk(context),
        this.userContext.getUserBehavior(context.userId),
        this.evaluateDeviceTrust(context.deviceId)
      ]);

      const decision = this.makeMFADecision(riskScore, userBehavior, deviceTrust);

      await this.logDecision(context, decision);
      return decision;
    } catch (error) {
      this.logger.error('MFA determination failed', { error, context });
      return this.getFallbackDecision();
    }
  }

  private async makeMFADecision(
    riskScore: number,
    userBehavior: UserBehavior,
    deviceTrust: DeviceTrust
  ): Promise<MFADecision> {
    // Implement decision logic based on multiple factors
    const requireMFA = riskScore > 0.6 || 
                      !deviceTrust.isCompliant ||
                      userBehavior.riskLevel === 'high';

    const methods = this.determineAllowedMethods(riskScore, deviceTrust);

    return {
      requireMFA,
      allowedMethods: methods,
      expirationMinutes: this.calculateSessionDuration(riskScore),
      reason: this.generateDecisionReason(riskScore, userBehavior, deviceTrust)
    };
  }

  private determineAllowedMethods(riskScore: number, deviceTrust: DeviceTrust): string[] {
    const methods = ['authenticator'];
    
    if (riskScore < 0.8 && deviceTrust.isCompliant) {
      methods.push('sms');
    }
    
    if (riskScore < 0.4 && deviceTrust.biometricsAvailable) {
      methods.push('biometric');
    }

    return methods;
  }
}