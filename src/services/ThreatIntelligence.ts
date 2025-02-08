import { Logger } from '../utils/Logger';
import { CacheManager } from './CacheManager';
import { AlertService } from './AlertService';

interface ThreatIndicator {
  type: string;
  value: string;
  confidence: number;
  severity: string;
  lastSeen: Date;
  source: string;
}

export class ThreatIntelligence {
  private logger: Logger;
  private cache: CacheManager;
  private alertService: AlertService;
  private providers: Map<string, ThreatProvider>;
  private indicatorCache: Map<string, ThreatIndicator>;

  constructor() {
    this.logger = new Logger('ThreatIntelligence');
    this.cache = new CacheManager(process.env.REDIS_URL);
    this.alertService = new AlertService();
    this.initializeProviders();
  }

  async checkIndicator(indicator: string, type: string): Promise<ThreatAssessment> {
    try {
      const cachedResult = await this.getFromCache(indicator);
      if (cachedResult) {
        return cachedResult;
      }

      const results = await this.queryProviders(indicator, type);
      const assessment = this.consolidateResults(results);

      await this.cacheResult(indicator, assessment);
      await this.handleThreatDetection(assessment);

      return assessment;
    } catch (error) {
      this.logger.error('Threat intelligence check failed', { indicator, error });
      throw new ThreatIntelligenceError('Failed to check indicator', error);
    }
  }

  private async queryProviders(
    indicator: string,
    type: string
  ): Promise<ProviderResult[]> {
    const queries = Array.from(this.providers.values()).map(provider =>
      provider.queryIndicator(indicator, type)
    );

    return Promise.all(queries);
  }

  private consolidateResults(results: ProviderResult[]): ThreatAssessment {
    const validResults = results.filter(r => r.confidence > 0.5);
    
    return {
      indicator: results[0].indicator,
      type: results[0].type,
      severity: this.calculateSeverity(validResults),
      confidence: this.calculateConfidence(validResults),
      sources: validResults.map(r => r.source),
      lastUpdated: new Date()
    };
  }

  private async handleThreatDetection(
    assessment: ThreatAssessment
  ): Promise<void> {
    if (assessment.severity === 'high' && assessment.confidence > 0.8) {
      await this.alertService.sendAlert({
        severity: 'high',
        component: 'ThreatIntelligence',
        message: 'High-confidence threat detected',
        details: assessment
      });
    }
  }
}