import { RealTimeAlertManager } from '../../src/services/RealTimeAlertManager';
import { EventBus } from '../../utils/EventBus';
import { MetricsCollector } from '../../src/services/MetricsCollector';
import { Logger } from '../../utils/Logger';

// Simple mock logger with sync no-ops
class MockLogger implements Partial<Logger> {
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
}

class MockMetricsCollector extends MetricsCollector {
  public recorded: Array<{ name: string; value: number; labels?: Record<string, any> }> = [];

  async recordMetric(name: string, value: number, labels?: Record<string, any>): Promise<void> {
    this.recorded.push({ name, value, labels });
  }
}

describe('RealTimeAlertManager', () => {
  it('triggers alert when threshold exceeded', async () => {
    const logger = new MockLogger();
    const metrics = new MockMetricsCollector();
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe('alert.new', payload => {
      received.push(payload);
    });

    const manager = new RealTimeAlertManager(logger as unknown as Logger, metrics, bus);

    await manager.processMetricUpdate('auth.failures', 10, { sourceIP: '1.2.3.4' });

    expect(received.length).toBe(1);
    expect(metrics.recorded.find(r => r.name === 'alerts.triggered')).toBeDefined();
  });

  it('resolves alert and records metrics', async () => {
    const logger = new MockLogger();
    const metrics = new MockMetricsCollector();
    const bus = new EventBus();
    const manager = new RealTimeAlertManager(logger as unknown as Logger, metrics, bus);

    await manager.processMetricUpdate('auth.failures', 10);
    const active = (manager as any).activeAlerts;
    const [alertId] = Array.from(active.keys()) as string[];

    await manager.resolveAlert(alertId, { summary: 'handled' });

    expect(metrics.recorded.find(r => r.name === 'alerts.resolved')).toBeDefined();
  });
});
