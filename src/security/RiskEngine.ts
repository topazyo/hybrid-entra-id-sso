import { GeoService } from '../services/GeoService';
import { DeviceService } from '../services/DeviceService';
import { BehaviorAnalyzer } from '../services/BehaviorAnalyzer';

export interface RiskContext {
  userId: string;
  ipAddress: string;
  deviceId: string;
  timestamp: Date;
  resource: string;
  userBehavior: UserBehaviorMetrics;
}

export interface RiskScore {
  total: number;
  factors: {
    location: number;
    device: number;
    behavior: number;
    time: number;
    resource: number;
  };
  recommendations: string[];
}

export class RiskEngine {
  private geoService: GeoService;
  private deviceService: DeviceService;
  private behaviorAnalyzer: BehaviorAnalyzer;

  constructor() {
    this.geoService = new GeoService();
    this.deviceService = new DeviceService();
    this.behaviorAnalyzer = new BehaviorAnalyzer();
  }

  async evaluateRisk(context: RiskContext): Promise<RiskScore> {
    try {
      const [
        locationRisk,
        deviceRisk,
        behaviorRisk,
        timeRisk,
        resourceRisk
      ] = await Promise.all([
        this.evaluateLocationRisk(context.ipAddress),
        this.evaluateDeviceRisk(context.deviceId),
        this.evaluateBehaviorRisk(context.userBehavior),
        this.evaluateTimeRisk(context.timestamp),
        this.evaluateResourceRisk(context.resource)
      ]);

      const totalRisk = this.calculateTotalRisk({
        location: locationRisk,
        device: deviceRisk,
        behavior: behaviorRisk,
        time: timeRisk,
        resource: resourceRisk
      });

      return {
        total: totalRisk,
        factors: {
          location: locationRisk,
          device: deviceRisk,
          behavior: behaviorRisk,
          time: timeRisk,
          resource: resourceRisk
        },
        recommendations: this.generateRecommendations(totalRisk)
      };
    } catch (error) {
      throw new RiskEvaluationError('Failed to evaluate risk', error);
    }
  }

  private async evaluateLocationRisk(ipAddress: string): Promise<number> {
    const location = await this.geoService.getLocation(ipAddress);
    return this.calculateLocationRiskScore(location);
  }

  private calculateTotalRisk(factors: Record<string, number>): number {
    const weights = {
      location: 0.3,
      device: 0.2,
      behavior: 0.25,
      time: 0.15,
      resource: 0.1
    };

    return Object.entries(factors).reduce((total, [factor, score]) => {
      return total + (score * weights[factor]);
    }, 0);
  }
}