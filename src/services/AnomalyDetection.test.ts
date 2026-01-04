import { AnomalyDetection } from './AnomalyDetection';
import { MachineLearningService, DetectionModel } from './MachineLearningService';
import { MetricsCollector } from './MetricsCollector';
import { AlertService } from './AlertService';

// Lightweight fakes to observe calls without network/metrics side effects.
class FakeML extends MachineLearningService {
  public next: any = 0;
  async predict(_model: DetectionModel, _data: unknown): Promise<any> {
    return this.next;
  }
}

class FakeMetrics extends MetricsCollector {
  public records: Array<{ name: string; value: number; labels?: Record<string, any> }> = [];
  async recordMetric(name: string, value: number, labels?: Record<string, any>): Promise<void> {
    this.records.push({ name, value, labels });
  }
}

class FakeAlerts extends AlertService {
  public alerts: any[] = [];
  async sendAlert(alertData: any): Promise<string> {
    this.alerts.push(alertData);
    return 'alert-1';
  }
}

describe('AnomalyDetection stubs', () => {
  it('returns no anomalies when score below threshold', async () => {
    const fakeMl = new FakeML();
    fakeMl.next = 0.2;
    const ad = new AnomalyDetection();
    (ad as any).mlService = fakeMl;
    (ad as any).alertService = new FakeAlerts();
    const res = await ad.detectAnomalies({ type: 'default', data: { x: 1 }, timestamp: new Date(), metadata: {} });
    expect(res.anomalies).toHaveLength(0);
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.confidence).toBeGreaterThanOrEqual(0);
  });

  it('emits anomaly, alert, and metric when score above threshold', async () => {
    const fakeMl = new FakeML();
    fakeMl.next = 0.9;
    const fakeMetrics = new FakeMetrics();
    const fakeAlerts = new FakeAlerts();
    const ad = new AnomalyDetection();
    (ad as any).mlService = fakeMl;
    (ad as any).metrics = fakeMetrics;
    (ad as any).alertService = fakeAlerts;

    const res = await ad.detectAnomalies({ type: 'default', data: { x: 1 }, timestamp: new Date(), metadata: { source: 'test' } });
    expect(res.anomalies).toHaveLength(1);
    expect(res.anomalies[0].score).toBeCloseTo(0.9);
    expect(fakeAlerts.alerts).toHaveLength(1);
    expect(fakeMetrics.records.some(r => r.name === 'anomalies_detected_total' && r.labels?.type === 'default')).toBe(true);
  });
});
