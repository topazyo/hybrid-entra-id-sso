// src/services/AuditLogger.ts

export interface AuditLogEvent {
  timestamp: Date;
  eventType: string;
  eventDetails: any;
  userId?: string;
  clientIp?: string;
  status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO';
  correlationId?: string;
  // Allow other string-keyed properties for global context merging
  [key: string]: any;
}

export interface SystemActivityLog {
    timestamp: Date;
    message: string;
    details: any;
    // Allow other string-keyed properties for global context merging
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

  public setGlobalContext(key: string, value: any): void {
    this.globalContext[key] = value;
  }

  public clearGlobalContext(key: string): void {
    delete this.globalContext[key];
  }
}

  public getGlobalContext(): Record<string, any> {
    return { ...this.globalContext }; // Return a copy
  }

  public logEvent(
    eventType: string,
    eventDetails: any,
    userId?: string,
    clientIp?: string,
    status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO',
    correlationId?: string
  ): void {
    const timestamp = new Date();
    // Merge global context first, then specific event details (eventDetails can override global)
    const finalEventDetails = { ...this.globalContext, ...eventDetails };

    const logEntry: AuditLogEvent = {
      timestamp,
      eventType,
      // Spread global context here as well for top-level fields if desired,
      // but typically eventDetails would be the primary carrier of dynamic data.
      // For this iteration, we'll keep global context primarily within eventDetails.
      // If global context keys might overlap with AuditLogEvent fixed keys, be careful.
      // Let's ensure eventDetails is the main place for combined context.
      eventDetails: finalEventDetails,
      userId,
      clientIp,
      status: status || 'INFO',
      correlationId,
    };
    // If we want globalContext fields at the same level as eventType, userId, etc.
    // const logEntryWithGlobal: AuditLogEvent = { ...this.globalContext, ...logEntry };
    // this.logger.info('AuditEvent', logEntryWithGlobal);
    // For now, let's keep it simpler: global context enriches eventDetails.

    this.logger.info('AuditEvent', logEntry);
  }

  public logSystemActivity(
    message: string,
    details?: any,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info'
  ): void {
    const timestamp = new Date();
    // Merge global context first, then specific details
    const finalDetails = { ...this.globalContext, ...(details || {}) };

    const logEntry: SystemActivityLog = { // Using SystemActivityLog interface
        timestamp,
        message,
        details: finalDetails,
    };
    // const logEntryWithGlobal: SystemActivityLog = { ...this.globalContext, ...logEntry};

    switch(level) {
        case 'info': this.logger.info('SystemActivity', logEntry); break;
        case 'warn': this.logger.warn('SystemActivity', logEntry); break;
        case 'error': this.logger.error('SystemActivity', logEntry); break;
        case 'debug':
            if (this.logger.debug) { this.logger.debug('SystemActivity', logEntry); }
            else { this.logger.info('SystemActivity [DEBUG]', logEntry); }
            break;
        default: this.logger.info('SystemActivity', logEntry); break;
    }
  }
}