import { Logger } from '../utils/Logger';
import { RiskEngine } from './RiskEngine';
import { BehavioralAnalytics } from '../services/BehavioralAnalytics';
import { AuditLogger } from '../services/AuditLogger';

interface AccessContext {
  location: LocationData;
  timeOfDay: TimeData;
  deviceHealth: DeviceData;
  userBehavior: BehaviorData;
  resourceSensitivity: ResourceData;
}

export class RiskBasedPolicyEngine {
  private logger: Logger;
  private riskEngine: RiskEngine;
  private behavioralAnalytics: BehavioralAnalytics;
  private auditLogger: AuditLogger;

  private weights = {
    location: 0.3,
    timeOfDay: 0.2,
    deviceHealth: 0.15,
    userBehavior: 0.25,
    resourceSensitivity: 0.1
  };

  constructor() {
    this.logger = new Logger('RiskBasedPolicyEngine');
    this.riskEngine = new RiskEngine();
    this.behavioralAnalytics = new BehavioralAnalytics();
    this.auditLogger = new AuditLogger(
      process.env.LOG_ANALYTICS_WORKSPACE_ID,
      process.env.LOG_ANALYTICS_KEY
    );
  }

  async evaluateRisk(context: AccessContext): Promise<RiskEvaluation> {
    try {
      const locationScore = await this.evaluateLocation(context.location);
      const timeScore = this.evaluateTime(context.timeOfDay);
      const deviceScore = await this.evaluateDevice(context.deviceHealth);
      const behaviorScore = await this.evaluateUserBehavior(context.userBehavior);
      const resourceScore = this.evaluateResource(context.resourceSensitivity);

      const totalScore = (
        locationScore * this.weights.location +
        timeScore * this.weights.timeOfDay +
        deviceScore * this.weights.deviceHealth +
        behaviorScore * this.weights.userBehavior +
        resourceScore * this.weights.resourceSensitivity
      );

      const evaluation: RiskEvaluation = {
        totalScore,
        factors: {
          location: locationScore,
          time: timeScore,
          device: deviceScore,
          behavior: behaviorScore,
          resource: resourceScore
        },
        requiredControls: this.determineRequiredControls(totalScore, context),
        recommendations: this.generateRecommendations(totalScore, context)
      };

      await this.logRiskEvaluation(context, evaluation);
      return evaluation;
    } catch (error) {
      this.logger.error('Risk evaluation failed', { error, context });
      throw new RiskEvaluationError('Failed to evaluate risk', error);
    }
  }

  private evaluateTime(timeData: TimeData): number {
    const hour = timeData.hour;
    const userTz = timeData.timezone;

    // Higher risk outside trading hours
    if (hour >= 9 && hour <= 17) return 0.0;  // Business hours
    if (hour >= 7 && hour <= 20) return 0.3;  // Extended hours
    return 1.0;  // Off hours
  }

  private async evaluateLocation(locationData: LocationData): Promise<number> {
    // Implement location-based risk evaluation
    if (locationData.isKnownLocation) return 0.1;
    if (locationData.isSuspiciousIP) return 1.0;
    if (locationData.isAnomalousLocation) return 0.7;
    return 0.3;
  }

  private determineRequiredControls(
    riskScore: number,
    context: AccessContext
  ): string[] {
    const controls: string[] = [];

    if (riskScore > 0.7) {
      controls.push('mfa_required');
      controls.push('manager_approval');
    } else if (riskScore > 0.4) {
      controls.push('mfa_required');
    }

    if (context.deviceHealth.complianceStatus !== 'compliant') {
      controls.push('device_compliance_check');
    }

    if (context.location.isAnomalousLocation) {
      controls.push('location_verification');
    }

    return controls;
  }

  private generateRecommendations(
    riskScore: number,
    context: AccessContext
  ): string[] {
    const recommendations: string[] = [];

    if (riskScore > 0.8) {
      recommendations.push('Implement step-up authentication');
      recommendations.push('Enable session recording');
    }

    if (context.userBehavior.anomalyScore > 0.6) {
      recommendations.push('Review user behavior patterns');
    }

    if (context.deviceHealth.riskScore > 0.5) {
      recommendations.push('Enforce device compliance policies');
    }

    return recommendations;
  }

  private async logRiskEvaluation(
    context: AccessContext,
    evaluation: RiskEvaluation
  ): Promise<void> {
    await this.auditLogger.logEvent({
      eventType: 'RiskEvaluation',
      userId: context.userBehavior.userId,
      resourceId: context.resourceSensitivity.resourceId,
      action: 'evaluate_risk',
      result: evaluation.totalScore > 0.7 ? 'high_risk' : 'low_risk',
      riskScore: evaluation.totalScore,
      metadata: {
        factors: evaluation.factors,
        requiredControls: evaluation.requiredControls,
        recommendations: evaluation.recommendations
      }
    });
  }
}