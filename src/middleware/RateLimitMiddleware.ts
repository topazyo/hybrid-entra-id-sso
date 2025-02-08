import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../services/RateLimiter';
import { Logger } from '../utils/Logger';

export class RateLimitMiddleware {
  private rateLimiter: RateLimiter;
  private logger: Logger;

  constructor() {
    this.rateLimiter = new RateLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100
    });
    this.logger = new Logger('RateLimitMiddleware');
  }

  middleware = async (req: Request, res: Response, next: NextFunction) => {
    const identifier = this.getIdentifier(req);

    try {
      const isLimited = await this.rateLimiter.isRateLimited(identifier);
      
      if (isLimited) {
        this.logger.warn('Rate limit exceeded', { identifier });
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.'
        });
        return;
      }

      const remaining = await this.rateLimiter.getRemainingRequests(identifier);
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      
      next();
    } catch (error) {
      this.logger.error('Rate limit check failed', { identifier, error });
      next(error);
    }
  };

  private getIdentifier(req: Request): string {
    // Use IP address as default identifier
    return req.ip;
  }
}