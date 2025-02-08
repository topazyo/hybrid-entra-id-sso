import { Logger } from '../utils/Logger';
import { CacheManager } from './CacheManager';
import { CryptoService } from './CryptoService';
import { RiskEngine } from '../security/RiskEngine';

interface SessionContext {
  userId: string;
  deviceId: string;
  ipAddress: string;
  authFactors: string[];
  riskScore: number;
}

export class SessionManager {
  private logger: Logger;
  private cache: CacheManager;
  private crypto: CryptoService;
  private riskEngine: RiskEngine;

  constructor() {
    this.logger = new Logger('SessionManager');
    this.cache = new CacheManager(process.env.REDIS_URL);
    this.crypto = new CryptoService();
    this.riskEngine = new RiskEngine();
  }

  async createSession(context: SessionContext): Promise<Session> {
    try {
      const sessionId = await this.generateSessionId();
      const session = {
        id: sessionId,
        userId: context.userId,
        created: new Date(),
        lastAccessed: new Date(),
        expiresAt: this.calculateExpiration(context),
        context: this.sanitizeContext(context)
      };

      await this.storeSession(session);
      await this.setupSessionMonitoring(session);

      return session;
    } catch (error) {
      this.logger.error('Session creation failed', { context, error });
      throw new SessionError('Failed to create session', error);
    }
  }

  async validateSession(sessionId: string, context: Partial<SessionContext>): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) return false;

      const currentRisk = await this.riskEngine.evaluateRisk({
        ...session.context,
        ...context
      });

      if (currentRisk > session.context.riskScore * 1.5) {
        await this.terminateSession(sessionId, 'risk_increase');
        return false;
      }

      await this.updateSessionActivity(session);
      return true;
    } catch (error) {
      this.logger.error('Session validation failed', { sessionId, error });
      return false;
    }
  }

  private async setupSessionMonitoring(session: Session): Promise<void> {
    // Set up real-time monitoring
    const monitoringInterval = setInterval(async () => {
      try {
        const isValid = await this.validateSession(session.id, {});
        if (!isValid) {
          clearInterval(monitoringInterval);
        }
      } catch (error) {
        this.logger.error('Session monitoring failed', { session, error });
      }
    }, 60000); // Check every minute

    // Cleanup on process exit
    process.on('beforeExit', () => {
      clearInterval(monitoringInterval);
    });
  }

  private calculateExpiration(context: SessionContext): Date {
    const baseTime = 4 * 60 * 60 * 1000; // 4 hours
    const riskFactor = Math.max(0.2, 1 - context.riskScore);
    return new Date(Date.now() + baseTime * riskFactor);
  }
}