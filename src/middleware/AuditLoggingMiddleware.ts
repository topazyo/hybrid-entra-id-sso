import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/Logger';
import { AuditLogger } from '../services/AuditLogger';
import { GeoService } from '../services/GeoService';

export class AuditLoggingMiddleware {
  private logger: Logger;
  private auditLogger: AuditLogger;
  private geoService: GeoService;

  constructor() {
    this.logger = new Logger('AuditLoggingMiddleware');
    this.auditLogger = new AuditLogger(
      process.env.LOG_ANALYTICS_WORKSPACE_ID,
      process.env.LOG_ANALYTICS_KEY
    );
    this.geoService = new GeoService();
  }

  middleware = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const startTime = Date.now();

    // Capture the original end function
    const originalEnd = res.end;
    const chunks: Buffer[] = [];

    // Override end function to capture response
    res.end = (...args: any[]): any => {
      if (args[0]) {
        chunks.push(Buffer.from(args[0]));
      }
      
      this.logAuditEvent(req, res, chunks, startTime)
        .catch(error => {
          this.logger.error('Failed to log audit event', { error });
        });

      originalEnd.apply(res, args);
    };

    next();
  };

  private async logAuditEvent(
    req: Request,
    res: Response,
    chunks: Buffer[],
    startTime: number
  ): Promise<void> {
    try {
      const geoLocation = await this.geoService.getLocation(req.ip);
      
      const auditEvent = {
        timestamp: new Date(),
        eventType: 'HttpRequest',
        userId: req.user?.id || 'anonymous',
        sourceIp: req.ip,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTime: Date.now() - startTime,
        userAgent: req.headers['user-agent'],
        geoLocation,
        requestHeaders: this.sanitizeHeaders(req.headers),
        queryParameters: req.query,
        responseSize: Buffer.concat(chunks).length,
        sessionId: req.session?.id,
        correlationId: req.headers['x-correlation-id']
      };

      await this.auditLogger.logEvent({
          eventType: 'HttpAudit',
          userId: auditEvent.userId,
          resourceId: auditEvent.path,
          action: auditEvent.method,
          result: res.statusCode < 400 ? 'success' : 'failure',
          metadata: auditEvent,
          riskScore: 0,
          timestamp: undefined
      });

    } catch (error) {
      this.logger.error('Audit logging failed', { error });
      throw error;
    }
  }

  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
    const sanitized = { ...headers };
    
    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}