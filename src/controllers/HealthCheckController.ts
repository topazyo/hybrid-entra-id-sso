import { Router, Request, Response } from 'express';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../services/MetricsCollector';
import { DatabaseService } from '../services/DatabaseService';
import { CacheManager } from '../services/CacheManager';

export class HealthCheckController {
  private router: Router;
  private logger: Logger;
  private metrics: MetricsCollector;
  private db: DatabaseService;
  private cache: CacheManager;

  constructor() {
    this.router = Router();
    this.logger = new Logger('HealthCheckController');
    this.metrics = new MetricsCollector();
    this.db = new DatabaseService();
    this.cache = new CacheManager(process.env.REDIS_URL);
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get('/health', this.getHealth.bind(this));
    this.router.get('/health/live', this.getLiveness.bind(this));
    this.router.get('/health/ready', this.getReadiness.bind(this));
  }

  private async getHealth(req: Request, res: Response): Promise<void> {
    try {
      const healthStatus = await this.checkOverallHealth();
      
      res.status(healthStatus.status === 'healthy' ? 200 : 503)
         .json(healthStatus);
    } catch (error) {
      this.logger.error('Health check failed', { error });
      res.status(500).json({
        status: 'error',
        message: 'Health check failed'
      });
    }
  }

  private async getLiveness(req: Request, res: Response): Promise<void> {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();

      res.status(200).json({
        status: 'alive',
        uptime,
        memoryUsage: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          rss: memoryUsage.rss
        }
      });
    } catch (error) {
      this.logger.error('Liveness check failed', { error });
      res.status(500).json({ status: 'error' });
    }
  }

  private async getReadiness(req: Request, res: Response): Promise<void> {
    try {
      const [dbStatus, cacheStatus] = await Promise.all([
        this.checkDatabaseConnection(),
        this.checkCacheConnection()
      ]);

      const isReady = dbStatus && cacheStatus;

      res.status(isReady ? 200 : 503).json({
        status: isReady ? 'ready' : 'not_ready',
        dependencies: {
          database: dbStatus ? 'connected' : 'disconnected',
          cache: cacheStatus ? 'connected' : 'disconnected'
        }
      });
    } catch (error) {
      this.logger.error('Readiness check failed', { error });
      res.status(500).json({ status: 'error' });
    }
  }

  private async checkOverallHealth(): Promise<HealthStatus> {
    const checks = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkCacheHealth(),
      this.checkMetricsHealth(),
      this.checkMemoryHealth()
    ]);

    const unhealthyChecks = checks.filter(check => !check.healthy);

    return {
      status: unhealthyChecks.length === 0 ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      checks,
      details: unhealthyChecks.map(check => check.details)
    };
  }

  private async checkMemoryHealth(): Promise<HealthCheck> {
    const memoryUsage = process.memoryUsage();
    const heapUsedPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    return {
      component: 'memory',
      healthy: heapUsedPercentage < 90,
      details: {
        heapUsedPercentage,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal
      }
    };
  }
}

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: Date;
  checks: HealthCheck[];
  details: any[];
}

interface HealthCheck {
  component: string;
  healthy: boolean;
  details: any;
}