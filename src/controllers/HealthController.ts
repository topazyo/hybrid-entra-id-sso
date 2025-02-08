import { Router } from 'express';
import { SessionManager } from '../services/SessionManager';
import { MainframeAuthBridge } from '../middleware/MainframeAuthBridge';

export class HealthController {
  private router: Router;
  private sessionManager: SessionManager;
  private mainframeBridge: MainframeAuthBridge;

  constructor() {
    this.router = Router();
    this.sessionManager = new SessionManager(config.security);
    this.mainframeBridge = new MainframeAuthBridge(config.mainframe);
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get('/health', this.getHealthStatus.bind(this));
    this.router.get('/health/detailed', this.getDetailedHealth.bind(this));
  }

  private async getHealthStatus(req, res): Promise<void> {
    try {
      const status = await this.checkSystemHealth();
      res.json({ status: status.healthy ? 'healthy' : 'unhealthy' });
    } catch (error) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  }

  private async getDetailedHealth(req, res): Promise<void> {
    try {
      const [
        sessionHealth,
        mainframeHealth,
        databaseHealth
      ] = await Promise.all([
        this.checkSessionHealth(),
        this.checkMainframeConnection(),
        this.checkDatabaseHealth()
      ]);

      res.json({
        sessions: sessionHealth,
        mainframe: mainframeHealth,
        database: databaseHealth,
        timestamp: new Date()
      });
    } catch (error) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  }
}