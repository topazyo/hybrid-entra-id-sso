import { Logger } from '../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { AlertService } from './AlertService';

interface BehaviorProfile {
  userId: string;
  patterns: UserPattern[];
  riskIndicators: RiskIndicator[];
  lastUpdated: Date;
  confidence: number;
}

export class BehavioralAnalytics {
  private logger: Logger;
  private metrics: MetricsCollector;
  private alertService: AlertService;
  private profiles: Map<string, BehaviorProfile>;

  constructor() {
    this.logger = new Logger('BehavioralAnalytics');
    this.metrics = new MetricsCollector();
    this.alertService = new AlertService();
    this.profiles = new Map();
  }

  async analyzeUserBehavior(activity: UserActivity): Promise<BehaviorAnalysis> {
    try {
      const profile = await this.getUserProfile(activity.userId);
      const analysis = await this.performAnalysis(activity, profile);
      
      if (analysis.anomalyScore > 0.7) {
        await this.handleAnomalousActivity(analysis);
      }

      await this.updateProfile(profile, analysis);
      return analysis;
    } catch (error) {
      this.logger.error('Behavior analysis failed', { activity, error });
      throw new AnalysisError('Failed to analyze user behavior', error);
    }
  }

  private async performAnalysis(
    activity: UserActivity,
    profile: BehaviorProfile
  ): Promise<BehaviorAnalysis> {
    const patterns = await this.detectPatterns(activity);
    const anomalies = await this.detectAnomalies(activity, profile);
    const riskScore = await this.calculateRiskScore(patterns, anomalies);

    return {
      timestamp: new Date(),
      patterns,
      anomalies,
      riskScore,
      confidence: this.calculateConfidence(patterns, profile)
    };
  }

  private async detectPatterns(activity: UserActivity): Promise<UserPattern[]> {
    const patterns: UserPattern[] = [];

    // Time-based patterns
    patterns.push(await this.analyzeTimePatterns(activity));

    // Location-based patterns
    patterns.push(await this.analyzeLocationPatterns(activity));

    // Resource access patterns
    patterns.push(await this.analyzeResourcePatterns(activity));

    return patterns;
  }

  private async detectAnomalies(
    activity: UserActivity,
    profile: BehaviorProfile
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Check for time anomalies
    if (this.isTimeAnomaly(activity, profile)) {
      anomalies.push({
        type: 'unusual_time',
        severity: 'medium',
        confidence: 0.8
      });
    }

    // Check for location anomalies
    if (await this.isLocationAnomaly(activity, profile)) {
      anomalies.push({
        type: 'unusual_location',
        severity: 'high',
        confidence: 0.9
      });
    }

    return anomalies;
  }
}