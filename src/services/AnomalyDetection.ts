import { Logger } from '../../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { AlertService } from './AlertService';
import { MachineLearningService, DetectionModel } from './MachineLearningService';
import { generateId } from '../../utils/IdGenerator';
import { Anomaly, AnomalyContext, AnomalyResult } from '../types/anomalies';
import { AlertSeverity } from '../types/alerts';

export class AnomalyDetectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AnomalyDetectionError';
  }
}

export class AnomalyDetection {
  private logger: Logger;
  private metrics: MetricsCollector;
  private alertService: AlertService;
  private mlService: MachineLearningService;
  private detectionModels: Map<string, DetectionModel>;

  constructor() {
    this.logger = new Logger('AnomalyDetection');
    this.metrics = new MetricsCollector();
    this.alertService = new AlertService();
    this.mlService = new MachineLearningService();
    this.detectionModels = new Map();
    this.initializeModels();
  }

  async detectAnomalies(context: AnomalyContext): Promise<AnomalyResult> {
    try {
      const model = this.detectionModels.get(context.type);
      if (!model) {
        throw new Error(`No model found for type: ${context.type}`);
      }

      const preprocessedData = await this.preprocessData(context);
      const anomalyScore = await this.calculateAnomalyScore(preprocessedData, model);
      const detectedAnomalies = await this.identifyAnomalies(anomalyScore, context);

      if (detectedAnomalies.length > 0) {
        await this.handleAnomalies(detectedAnomalies, context);
      }

      return {
        timestamp: new Date(),
        score: anomalyScore,
        anomalies: detectedAnomalies,
        confidence: this.calculateConfidence(anomalyScore, context)
      };
    } catch (error) {
      this.logger.error('Anomaly detection failed', { context, error });
      throw new AnomalyDetectionError('Failed to detect anomalies', error);
    }
  }

  private async preprocessData(context: AnomalyContext): Promise<any> {
    const normalizedData = await this.normalizeData(context.data);
    const enrichedData = await this.enrichData(normalizedData, context.metadata);
    return this.filterData(enrichedData);
  }

  private async calculateAnomalyScore(
    data: any,
    model: DetectionModel
  ): Promise<number> {
    const predictions = await this.mlService.predict(model, data);
    return this.calculateScore(predictions, data);
  }

  private async handleAnomalies(
    anomalies: Anomaly[],
    context: AnomalyContext
  ): Promise<void> {
    const severity = this.determineSeverity(anomalies);
    
    await this.alertService.sendAlert({
      severity,
      component: 'AnomalyDetection',
      message: 'Anomalies detected',
      details: { anomalies, context }
    });

    await this.metrics.recordMetric('anomalies_detected_total', anomalies.length || 1, {
      type: context.type,
      severity
    });
    await this.updateModels(anomalies, context);
  }

  // ---- Stubs / default implementations to keep build green ----

  private initializeModels(): void {
    // Register a default model per context type; real implementations should load trained models.
    this.detectionModels.set('default', { id: 'default-model', name: 'rule-based' });
  }

  private async normalizeData(data: any): Promise<any> {
    // Simple pass-through normalization; placeholder for scaling/encoding.
    return data;
  }

  private async enrichData(data: any, metadata: Record<string, any>): Promise<any> {
    return { data, metadata };
  }

  private filterData(enriched: any): any {
    return enriched;
  }

  private async identifyAnomalies(score: number, context: AnomalyContext): Promise<Anomaly[]> {
    const threshold = 0.7;
    if (score < threshold) return [];
    return [{ id: generateId('anomaly'), type: context.type, score, details: context.metadata }];
  }

  private calculateScore(predictions: any, _data: any): number {
    if (typeof predictions === 'number') return this.clamp(predictions, 0, 1);
    if (Array.isArray(predictions)) {
      const maxVal = Math.max(...predictions.map(p => (typeof p === 'number' ? p : 0)), 0);
      return this.clamp(maxVal, 0, 1);
    }
    if (predictions && typeof predictions === 'object') {
      const firstNumeric = Object.values(predictions).find(v => typeof v === 'number') as number | undefined;
      return this.clamp(firstNumeric ?? 0, 0, 1);
    }
    return 0;
  }

  private determineSeverity(anomalies: Anomaly[]): AlertSeverity {
    const maxScore = Math.max(...anomalies.map(a => a.score), 0);
    if (maxScore >= 0.9) return 'critical';
    if (maxScore >= 0.75) return 'high';
    if (maxScore >= 0.5) return 'medium';
    return 'low';
  }

  private calculateConfidence(score: number, _context: AnomalyContext): number {
    return this.clamp(score, 0, 1);
  }

  private async updateModels(_anomalies: Anomaly[], _context: AnomalyContext): Promise<void> {
    // Placeholder: could update online models or feedback loops.
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}