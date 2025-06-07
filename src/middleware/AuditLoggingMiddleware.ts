// src/middleware/AuditLoggingMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { AuditLogger } from '../services/AuditLogger'; // Assuming AuditLogger is in services
import { IncomingHttpHeaders } from 'http'; // For typing req.headers

export class AuditLoggingMiddleware {
  private auditLogger: AuditLogger;

  constructor(auditLogger: AuditLogger) {
    this.auditLogger = auditLogger;
    this.auditLogger.setGlobalContext('middleware', 'AuditLoggingMiddleware'); // Optional: context for logs from this middleware
    this.auditLogger.logSystemActivity('AuditLoggingMiddleware initialized');
  }

  public logRequest = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    // Ensure correlationId is set or generated if not present
    let correlationId = req.headers['x-correlation-id'] as string | undefined;
    if (!correlationId) {
        correlationId = `http-${Date.now()}-${Math.random().toString(36).substring(2,9)}`;
        req.headers['x-correlation-id'] = correlationId; // Make it available to subsequent handlers/loggers
    }
    // Also set it on res for consistency in logging, though it's mainly for tracking requests
    res.setHeader('X-Correlation-ID', correlationId);


    this.auditLogger.logSystemActivity(
      'INCOMING_HTTP_REQUEST', // More specific event type
      {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        correlationId: correlationId,
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'],
        // Log body presence/size instead of full body for sensitive data
        bodySize: req.body ? JSON.stringify(req.body).length : 0,
        // Example: Mask sensitive headers before logging
        // headers: this.maskSensitiveHeaders(req.headers),
      },
      'info'
    );

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      this.auditLogger.logSystemActivity(
        'HTTP_RESPONSE_SENT', // More specific event type
        {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          durationMs: durationMs,
          correlationId: correlationId,
          // Potentially log response size or key response headers if needed
          // responseContentLength: res.getHeader('Content-Length'),
        },
        res.statusCode >= 400 ? (res.statusCode >= 500 ? 'error' : 'warn') : 'info'
      );
    });
    next();
  }

  // Example helper for masking, not fully implemented for brevity
  // private maskSensitiveHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  //   const sensitive = ['authorization', 'cookie', 'set-cookie'];
  //   const masked: IncomingHttpHeaders = {};
  //   for (const key in headers) {
  //     if (sensitive.includes(key.toLowerCase())) {
  //       masked[key] = '***MASKED***';
  //     } else {
  //       masked[key] = headers[key];
  //     }
  //   }
  //   return masked;
  // }
}
