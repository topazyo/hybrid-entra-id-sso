// src/services/AuditLogger.ts

// Define the structure for an audit log event
export interface AuditLogEvent {
  timestamp: Date;
  eventType: string;
  eventDetails: any;
  userId?: string;
  clientIp?: string;
  status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO'; // Added INFO
  correlationId?: string;
}

// Define a generic LogProvider interface.
// This allows injecting different logging libraries (e.g., Winston, Pino, console)
// or a custom logging service that might write to a database or message queue.
export interface LogProvider {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug?(message: string, meta?: any): void; // Optional debug method
}

// A simple console-based log provider for default usage if no other is provided.
export class ConsoleLogProvider implements LogProvider {
  private formatMeta(meta?: any): string {
    if (!meta) return "";
    // Basic stringification, could be more sophisticated (e.g., handling circular refs)
    try {
      return JSON.stringify(meta, null, 2);
    } catch (e) {
      return "[Unserializable Meta]";
    }
  }

  info(message: string, meta?: any): void {
    console.info(`[INFO] ${message} ${this.formatMeta(meta)}`);
  }

  warn(message: string, meta?: any): void {
    console.warn(`[WARN] ${message} ${this.formatMeta(meta)}`);
  }

  error(message: string, meta?: any): void {
    console.error(`[ERROR] ${message} ${this.formatMeta(meta)}`);
  }

  debug(message: string, meta?: any): void {
    // console.debug is not standard on all Node versions, use log
    console.log(`[DEBUG] ${message} ${this.formatMeta(meta)}`);
  }
}

export class AuditLogger {
  private logger: LogProvider;

  constructor(logProvider?: LogProvider) {
    this.logger = logProvider || new ConsoleLogProvider();
    // In a real application, you might have more complex configuration here,
    // such as log levels, formatting, or multiple log destinations.
  }

  /**
   * Logs a specific audit event.
   * @param eventType - The type of event (e.g., 'USER_LOGIN', 'FILE_UPLOAD').
   * @param eventDetails - Specific details about the event.
   * @param userId - Optional ID of the user associated with the event.
   * @param clientIp - Optional IP address of the client.
   * @param status - Optional status of the event.
   * @param correlationId - Optional ID to correlate related events.
   */
  public logEvent(
    eventType: string,
    eventDetails: any,
    userId?: string,
    clientIp?: string,
    status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO',
    correlationId?: string
  ): void {
    const timestamp = new Date();
    const logEntry: AuditLogEvent = {
      timestamp,
      eventType,
      eventDetails,
      userId,
      clientIp,
      status: status || 'INFO', // Default to INFO if no status provided
      correlationId,
    };

    // Using the injected logger to record the event.
    // The message "AuditEvent" can be used by log management systems to filter these logs.
    this.logger.info('AuditEvent', logEntry);
  }

  /**
   * Logs a general system activity or message.
   * @param message - The main message to log.
   * @param details - Additional details or context for the activity.
   * @param level - The severity level of the log ('info', 'warn', 'error', 'debug').
   */
  public logSystemActivity(
    message: string,
    details?: any,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info'
  ): void {
    const logEntry = {
        timestamp: new Date(),
        message,
        details: details || {}, // Ensure details is an object
    };

    switch(level) {
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
            if (this.logger.debug) { // Check if debug method exists
                this.logger.debug('SystemActivity', logEntry);
            } else {
                this.logger.info('SystemActivity [DEBUG]', logEntry); // Fallback for providers without debug
            }
            break;
        default:
            this.logger.info('SystemActivity', logEntry); // Fallback for unknown levels
            break;
    }
  }
}

// Example of how it might be instantiated and used (optional, for illustration)
// if (require.main === module) {
//   const auditLogger = new AuditLogger(); // Uses ConsoleLogProvider by default
//   auditLogger.logEvent(
//     'USER_REGISTRATION',
//     { username: 'johndoe', email: 'john.doe@example.com' },
//     'user_guid_12345',
//     '127.0.0.1',
//     'SUCCESS'
//   );
//   auditLogger.logSystemActivity('Service started successfully', { port: 3000, environment: 'development' });
//   auditLogger.logSystemActivity('A minor issue occurred', { issueCode: 101 }, 'warn');
// }
