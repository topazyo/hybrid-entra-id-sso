import { Logger } from '../utils/Logger';
import { GeoService } from './GeoService';
import { DeviceTrustService } from './DeviceTrustService';
import { BehavioralAnalytics } from './BehavioralAnalytics';

interface RiskContext {
  userId: string;
  ipAddress: string;
  deviceId: string;
  timestamp: Date;
  resourceId: string;
  userTimezone: string;
}

interface RiskScore {
  total: number;
  factors: {
    location: number;
    timeOfDay: number;
    deviceHealth: number;
    userBehavior: number;
    resourceSensitivity: number;
  };
  recommendations: string[];
}

export class RiskScoringEngine {
  private logger: Logger;
  private geoService: GeoService;
  private deviceTrust: DeviceTrustService;
  private behavioralAnalytics: BehavioralAnalytics;

  private weights = {
    location: 0.3,
    timeOfDay: 0.2,
    deviceHealth: 0.15,
    userBehavior: 0.25,
    resourceSensitivity: 0.1
  };

  constructor() {
    this.logger = new Logger('RiskScoringEngine');
    this.geoService = new GeoService();
    this.deviceTrust = new DeviceTrustService();
    this.behavioralAnalytics = new BehavioralAnalytics();
  }

  async calculateRiskScore(context: RiskContext): Promise<RiskScore> {
    try {
      const [
        locationScore,
        timeScore,
        deviceScore,
        behaviorScore,
        resourceScore
      ] = await Promise.all([
        this.evaluateLocation(context.ipAddress),
        this.evaluateTime(context.timestamp, context.userTimezone),
        this.evaluateDevice(context.deviceId),
        this.evaluateUserBehavior(context.userId),
        this.evaluateResource(context.resourceId)
      ]);

      const factors = {
        location: locationScore,
        timeOfDay: timeScore,
        deviceHealth: deviceScore,
        userBehavior: behaviorScore,
        resourceSensitivity: resourceScore
      };

      const totalScore = this.calculateTotalScore(factors);
      const recommendations = this.generateRecommendations(factors);

      return {
        total: totalScore,
        factors,
        recommendations
      };
    } catch (error) {
      this.logger.error('Risk score calculation failed', { context, error });
      throw new RiskScoringError('Failed to calculate risk score', error);
    }
  }

  private async evaluateLocation(ipAddress: string): Promise<number> {
    const location = await this.geoService.getLocation(ipAddress);
    
    // Higher risk for unusual locations
    if (location.riskLevel === 'high') return 1.0;
    if (location.riskLevel === 'medium') return 0.5;
    return 0.1;
  }

  private evaluateTime(timestamp: Date, userTz: string): Promise<number> {
    const userTime = new Date(timestamp).toLocaleString('en-US', { timeZone: userTz });
    const hour = new Date(userTime).getHours();

    // Higher risk outside business hours
    if (hour >= 9 && hour <= 17) return 0.1;  // Business hours
    if (hour >= 7 && hour <= 20) return 0.5;  // Extended hours
    return 1.0;  // Off hours
  }

  private calculateTotalScore(factors: Record<string, number>): number {
    return Object.entries(factors).reduce((total, [factor, score]) => {
      return total + (score * this.weights[factor]);
    }, 0);
  }

  private generateRecommendations(factors: Record<string, number>): string[] {
    const recommendations: string[] = [];

    if (factors.location > 0.7) {
      recommendations.push('Require location verification');
    }
    if (factors.deviceHealth > 0.6) {
      recommendations.push('Require device compliance check');
    }
    if (factors.timeOfDay > 0.8) {
      recommendations.push('Require manager approval');
    }

    return recommendations;
  }
}