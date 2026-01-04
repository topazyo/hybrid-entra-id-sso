// src/services/AuditLogger.ts

export interface AuditLogEvent {
  /** Timestamp when the audit event was created. */
  timestamp: Date;
  /** Logical event name or identifier. */
  eventType: string;
  /** Structured payload for the event. */
  eventDetails: any;
  /** Optional user identifier associated with the event. */
  userId?: string;
  /** Optional client IP address. */
  clientIp?: string;
  /** Outcome for the event. */
  status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO';
  /** Correlation ID for request tracing. */
  correlationId?: string;
  /** Allow other string-keyed properties for global context merging. */
  [key: string]: any;
}

export interface SystemActivityLog {
  timestamp: Date;
  message: string;
  details: any;
  /** Allow other string-keyed properties for global context merging. */
  [key: string]: any;
}

export interface LogProvider {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug?(message: string, meta?: any): void;
}

export class ConsoleLogProvider implements LogProvider {
  private formatMeta(meta?: any): string {
    if (!meta) return "";
    try {
      return JSON.stringify(meta, null, 2);
    } catch (e) { return "[Unserializable Meta]"; }
  }
  info(message: string, meta?: any): void { console.info(`[INFO] ${message} ${this.formatMeta(meta)}`); }
  warn(message: string, meta?: any): void { console.warn(`[WARN] ${message} ${this.formatMeta(meta)}`); }
  error(message: string, meta?: any): void { console.error(`[ERROR] ${message} ${this.formatMeta(meta)}`); }
  debug(message: string, meta?: any): void { console.log(`[DEBUG] ${message} ${this.formatMeta(meta)}`); }
}

export class AuditLogger {
  private logger: LogProvider;
  private globalContext: Record<string, any> = {};

  constructor(logProvider?: LogProvider) {
    this.logger = logProvider || new ConsoleLogProvider();
  }

  /** Set a global context key applied to all log entries. */
  public setGlobalContext(key: string, value: any): void {
    this.globalContext[key] = value;
  }

  /** Remove a global context key. */
  public clearGlobalContext(key: string): void {
    delete this.globalContext[key];
  }

  /** Retrieve current global context (copied to avoid external mutation). */
  public getGlobalContext(): Record<string, any> {
    return { ...this.globalContext };
  }

  /** Log a structured audit event with optional context. */
  public logEvent(
    eventType: string,
    eventDetails: any,
    userId?: string,
    clientIp?: string,
    status: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO' = 'INFO',
    correlationId?: string
  ): void {
    const timestamp = new Date();
    const finalEventDetails = { ...this.globalContext, ...eventDetails };

    const logEntry: AuditLogEvent = {
      timestamp,
      eventType,
      eventDetails: finalEventDetails,
      userId,
      clientIp,
      status,
      correlationId,
    };

    this.logger.info('AuditEvent', logEntry);
  }

  /** Log system activity (non-audit) with level selection. */
  public logSystemActivity(
    message: string,
    details?: any,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info'
  ): void {
    const timestamp = new Date();
    const finalDetails = { ...this.globalContext, ...(details || {}) };

    const logEntry: SystemActivityLog = {
      timestamp,
      message,
      details: finalDetails,
    };

    switch (level) {
      case 'info':
        this.logger.info('SystemActivity', logEntry);
        break;
      case 'warn':
        this.logger.warn('SystemActivity', logEntry);
        break;
      case 'error':
        this.logger.error('SystemActivity', logEntry);
        break;
      case 'debug':
        if (this.logger.debug) {
          this.logger.debug('SystemActivity', logEntry);
        } else {
          this.logger.info('SystemActivity [DEBUG]', logEntry);
        }
        break;
      default:
        this.logger.info('SystemActivity', logEntry);
        break;
    }
  }
}
