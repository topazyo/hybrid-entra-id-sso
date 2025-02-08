import { Redis } from 'ioredis';
import { Logger } from '../utils/Logger';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export class RateLimiter {
  private redis: Redis;
  private logger: Logger;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.redis = new Redis(process.env.REDIS_URL);
    this.logger = new Logger('RateLimiter');
    this.config = {
      keyPrefix: 'ratelimit:',
      ...config
    };
  }

  async isRateLimited(identifier: string): Promise<boolean> {
    const key = `${this.config.keyPrefix}${identifier}`;
    
    try {
      const multi = this.redis.multi();
      const now = Date.now();
      const windowStart = now - this.config.windowMs;

      // Remove old entries
      multi.zremrangebyscore(key, 0, windowStart);
      // Add new request
      multi.zadd(key, now, `${now}`);
      // Count requests in window
      multi.zcard(key);
      // Set expiry
      multi.expire(key, Math.ceil(this.config.windowMs / 1000));

      const [, , requestCount] = await multi.exec();
      
      return requestCount[1] > this.config.maxRequests;
    } catch (error) {
      this.logger.error('Rate limit check failed', { identifier, error });
      return false; // Fail open on error
    }
  }

  async getRemainingRequests(identifier: string): Promise<number> {
    const key = `${this.config.keyPrefix}${identifier}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    try {
      await this.redis.zremrangebyscore(key, 0, windowStart);
      const requestCount = await this.redis.zcard(key);
      return Math.max(0, this.config.maxRequests - requestCount);
    } catch (error) {
      this.logger.error('Failed to get remaining requests', { identifier, error });
      return 0;
    }
  }
}