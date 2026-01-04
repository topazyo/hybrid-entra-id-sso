import * as winston from 'winston';

interface LogContext {
  component?: string;
  correlationId?: string;
  userId?: string;
  [key: string]: any;
}

export class Logger {
  private logger!: winston.Logger;
  private component: string;

  constructor(component: string) {
    this.component = component;
    this.initializeLogger();
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
    this.logger.log(level, message, enrichedContext);
  }

  private enrichContext(context?: LogContext): LogContext {
    return {
      component: this.component,
      environment: process.env.NODE_ENV,
      version: process.env.APP_VERSION,
      correlationId: context?.correlationId,
      ...context,
    };
  }
}