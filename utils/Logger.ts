import * as winston from 'winston';
import { LogAnalyticsClient } from '@azure/monitor-ingestion';

interface LogContext {
  component: string;
  correlationId?: string;
  userId?: string;
  [key: string]: any;
}

export class Logger {
  private logger: winston.Logger;
  private logAnalyticsClient?: LogAnalyticsClient;
  private component: string;

  constructor(component: string) {
    this.component = component;
    this.initializeLogger();
    this.initializeLogAnalytics();
  }

  private initializeLogger(): void {
    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      defaultMeta: { component: this.component },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error'
        }),
        new winston.transports.File({
          filename: 'logs/combined.log'
        })
      ]
    });
  }

  private initializeLogAnalytics(): void {
    if (process.env.LOG_ANALYTICS_WORKSPACE_ID && process.env.LOG_ANALYTICS_KEY) {
      this.logAnalyticsClient = new LogAnalyticsClient(
        process.env.LOG_ANALYTICS_WORKSPACE_ID,
        process.env.LOG_ANALYTICS_KEY
      );
    }
  }

  async info(message: string, context?: LogContext): Promise<void> {
    await this.log('info', message, context);
  }

  async warn(message: string, context?: LogContext): Promise<void> {
    await this.log('warn', message, context);
  }

  async error(message: string, context?: LogContext): Promise<void> {
    await this.log('error', message, context);
  }

  async debug(message: string, context?: LogContext): Promise<void> {
    await this.log('debug', message, context);
  }

  private async log(
    level: string,
    message: string,
    context?: LogContext
  ): Promise<void> {
    const enrichedContext = this.enrichContext(context);
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...enrichedContext
    };

    // Log to Winston
    this.logger.log(level, message, enrichedContext);

    // Log to Azure Log Analytics if configured
    if (this.logAnalyticsClient && level !== 'debug') {
      await this.sendToLogAnalytics(level, logEntry);
    }
  }

  private enrichContext(context?: LogContext): LogContext {
    return {
      component: this.component,
      environment: process.env.NODE_ENV,
      version: process.env.APP_VERSION,
      correlationId: context?.correlationId || crypto.randomUUID(),
      ...context
    };
  }

  private async sendToLogAnalytics(
    level: string,
    logEntry: any
  ): Promise<void> {
    try {
      if (this.logAnalyticsClient) {
        await this.logAnalyticsClient.upload(
          'HybridSSOLogs',
          [logEntry],
          { timeGenerated: new Date() }
        );
      }
    } catch (error) {
      this.logger.error('Failed to send log to Log Analytics', {
        error,
        logEntry
      });
    }
  }

  async flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.on('finish', resolve);
      this.logger.end();
    });
  }
}