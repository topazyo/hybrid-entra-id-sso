import { Redis } from 'ioredis';
import { Logger } from '../utils/Logger';

export class CacheManager {
  private redis: Redis;
  private logger: Logger;
  private prefix: string;

  constructor(redisUrl: string, prefix: string = 'sso:') {
    this.redis = new Redis(redisUrl);
    this.logger = new Logger('CacheManager');
    this.prefix = prefix;

    this.redis.on('error', this.handleRedisError.bind(this));
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(this.prefix + key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.logger.error('Cache get error', { key, error });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.setex(this.prefix + key, ttlSeconds, serialized);
      } else {
        await this.redis.set(this.prefix + key, serialized);
      }
    } catch (error) {
      this.logger.error('Cache set error', { key, error });
    }
  }

  async invalidate(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(this.prefix + pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error('Cache invalidation error', { pattern, error });
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}