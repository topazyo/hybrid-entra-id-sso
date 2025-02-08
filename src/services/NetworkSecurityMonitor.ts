import { Logger } from '../utils/Logger';
import { MetricsCollector } from './MetricsCollector';
import { AlertService } from './AlertService';
import { GeoService } from './GeoService';

interface NetworkEvent {
  sourceIp: string;
  destinationIp: string;
  protocol: string;
  port: number;
  timestamp: Date;
  bytes: number;
  action: 'allow' | 'deny';
}

export class NetworkSecurityMonitor {
  private logger: Logger;
  private metrics: MetricsCollector;
  private alertService: AlertService;
  private geoService: GeoService;
  private anomalyThresholds: Map<string, number>;

  constructor() {
    this.logger = new Logger('NetworkSecurityMonitor');
    this.metrics = new MetricsCollector();
    this.alertService = new AlertService();
    this.geoService = new GeoService();
    this.initializeThresholds();
  }

  private initializeThresholds(): void {
    this.anomalyThresholds = new Map([
      ['bytes_per_minute', 1000000], // 1MB per minute
      ['denied_connections', 10],     // 10 denied connections
      ['suspicious_ports', 5]         // 5 suspicious port attempts
    ]);
  }

  async monitorNetworkTraffic(events: NetworkEvent[]): Promise<void> {
    try {
      const analysis = await this.analyzeNetworkEvents(events);
      await this.handleAnalysisResults(analysis);
      await this.updateMetrics(analysis);

      if (analysis.anomalies.length > 0) {
        await this.handleAnomalies(analysis.anomalies);
      }
    } catch (error) {
      this.logger.error('Network monitoring failed', { error });
      throw error;
    }
  }

  private async analyzeNetworkEvents(
    events: NetworkEvent[]
  ): Promise<NetworkAnalysis> {
    const analysis: NetworkAnalysis = {
      timestamp: new Date(),
      totalEvents: events.length,
      bytesTransferred: 0,
      deniedConnections: 0,
      suspiciousPorts: new Set<number>(),
      anomalies: [],
      geoLocations: new Map<string, number>()
    };

    for (const event of events) {
      analysis.bytesTransferred += event.bytes;
      
      if (event.action === 'deny') {
        analysis.deniedConnections++;
      }

      if (this.isSuspiciousPort(event.port)) {
        analysis.suspiciousPorts.add(event.port);
      }

      const location = await this.geoService.getLocation(event.sourceIp);
      const currentCount = analysis.geoLocations.get(location.country) || 0;
      analysis.geoLocations.set(location.country, currentCount + 1);
    }

    analysis.anomalies = await this.detectAnomalies(analysis);
    return analysis;
  }

  private async detectAnomalies(
    analysis: NetworkAnalysis
  ): Promise<NetworkAnomaly[]> {
    const anomalies: NetworkAnomaly[] = [];

    // Check bytes transferred
    const bytesPerMinute = analysis.bytesTransferred / 60;
    if (bytesPerMinute > this.anomalyThresholds.get('bytes_per_minute')) {
      anomalies.push({
        type: 'excessive_traffic',
        severity: 'high',
        details: { bytesPerMinute }
      });
    }

    // Check denied connections
    if (analysis.deniedConnections > this.anomalyThresholds.get('denied_connections')) {
      anomalies.push({
        type: 'excessive_denials',
        severity: 'medium',
        details: { count: analysis.deniedConnections }
      });
    }

    // Check suspicious ports
    if (analysis.suspiciousPorts.size > this.anomalyThresholds.get('suspicious_ports')) {
      anomalies.push({
        type: 'suspicious_ports',
        severity: 'high',
        details: { ports: Array.from(analysis.suspiciousPorts) }
      });
    }

    return anomalies;
  }

  private async handleAnomalies(anomalies: NetworkAnomaly[]): Promise<void> {
    for (const anomaly of anomalies) {
      await this.alertService.sendAlert({
        severity: anomaly.severity,
        component: 'NetworkSecurity',
        message: `Network anomaly detected: ${anomaly.type}`,
        details: anomaly.details
      });
    }
  }

  private isSuspiciousPort(port: number): boolean {
    const suspiciousPorts = [21, 22, 23, 25, 135, 445, 1433, 3389];
    return suspiciousPorts.includes(port);
  }

  private async updateMetrics(analysis: NetworkAnalysis): Promise<void> {
    await this.metrics.recordMetrics({
      'network.bytes_transferred': analysis.bytesTransferred,
      'network.denied_connections': analysis.deniedConnections,
      'network.suspicious_ports': analysis.suspiciousPorts.size,
      'network.unique_countries': analysis.geoLocations.size
    });
  }
}

interface NetworkAnalysis {
  timestamp: Date;
  totalEvents: number;
  bytesTransferred: number;
  deniedConnections: number;
  suspiciousPorts: Set<number>;
  anomalies: NetworkAnomaly[];
  geoLocations: Map<string, number>;
}

interface NetworkAnomaly {
  type: string;
  severity: 'low' | 'medium' | 'high';
  details: any;
}