import { LogAnalyticsClient } from '@azure/monitor-ingestion';
import { Logger } from '../utils/Logger';

export interface AuditEvent {
  eventType: string;
  userId: string;
  resourceId: string;
  action: string;
  result: 'success' | 'failure';
  riskScore: number;
  metadata: Record<string, any>;
  timestamp: Date;
}

export class AuditLogger {
  private logAnalytics: LogAnalyticsClient;
  private logger: Logger;
  private workspaceId: string;

  constructor(workspaceId: string, sharedKey: string) {
    this.logAnalytics = new LogAnalyticsClient(workspaceId, sharedKey);
    this.logger = new Logger('AuditLogger');
    this.workspaceId = workspaceId;
  }

  async logEvent(event: AuditEvent): Promise<void> {
    try {
      const logEntry = this.formatLogEntry(event);
      
      await Promise.all([
        this.logAnalytics.upload('HybridSSOAudit', [logEntry]),
        this.logToLocalStorage(logEntry)
      ]);

      this.logger.debug('Audit event logged successfully', { eventId: event.id });
    } catch (error) {
      this.logger.error('Failed to log audit event', { error, event });
      throw new AuditLoggingError('Failed to log audit event', error);
    }
  }

  private formatLogEntry(event: AuditEvent): Record<string, any> {
    return {
      TimeGenerated: event.timestamp.toISOString(),
      EventType: event.eventType,
      UserId: event.userId,
      ResourceId: event.resourceId,
      Action: event.action,
      Result: event.result,
      RiskScore: event.riskScore,
      ClientIP: event.metadata.clientIP,
      UserAgent: event.metadata.userAgent,
      Location: event.metadata.location,
      DeviceId: event.metadata.deviceId
    };
  }

  private async logToLocalStorage(logEntry: Record<string, any>): Promise<void> {
    // Implement local backup logging mechanism
  }
}