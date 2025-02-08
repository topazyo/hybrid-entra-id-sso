import { Logger } from '../utils/Logger';
import { BehavioralAnalytics } from './BehavioralAnalytics';
import { RiskEngine } from '../security/RiskEngine';
import { SessionManager } from './SessionManager';

interface AuthenticationContext {
  sessionId: string;
  userId: string;
  deviceId: string;
  activity: UserActivity;
  timestamp: Date;
}

export class ContinuousAuth {
  private logger: Logger;
  private behavioralAnalytics: BehavioralAnalytics;
  private riskEngine: RiskEngine;
  private sessionManager: SessionManager;
  private monitoringIntervals: Map<string, NodeJS.Timeout>;

  constructor() {
    this.logger = new Logger('ContinuousAuth');
    this.behavioralAnalytics = new BehavioralAnalytics();
    this.riskEngine = new RiskEngine();
    this.sessionManager = new SessionManager();
    this.monitoringIntervals = new Map();
  }

  async startMonitoring(context: AuthenticationContext): Promise<void> {
    try {
      await this.validateInitialState(context);
      await this.setupContinuousMonitoring(context);
      await this.initializeBaseline(context);
    } catch (error) {
      this.logger.error('Failed to start continuous authentication', { context, error });
      throw new ContinuousAuthError('Failed to initialize monitoring', error);
    }
  }

  private async setupContinuousMonitoring(context: AuthenticationContext): Promise<void> {
    const interval = setInterval(async () => {
      try {
        await this.performAuthenticationCheck(context);
      } catch (error) {
        this.logger.error('Continuous authentication check failed', { context, error });
        await this.handleMonitoringFailure(context, error);
      }
    }, 30000); // Check every 30 seconds

    this.monitoringIntervals.set(context.sessionId, interval);
  }

  private async performAuthenticationCheck(context: AuthenticationContext): Promise<void> {
    const [behaviorScore, riskScore] = await Promise.all([
      this.behavioralAnalytics.analyzeUserBehavior(context.activity),
      this.riskEngine.evaluateRisk(context)
    ]);

    if (this.requiresReauthentication(behaviorScore, riskScore)) {
      await this.initiateReauthentication(context);
    }

    await this.updateAuthenticationState(context, { behaviorScore, riskScore });
  }

  private requiresReauthentication(behaviorScore: number, riskScore: number): boolean {
    return behaviorScore < 0.6 || riskScore > 0.7;
  }

  private async initiateReauthentication(context: AuthenticationContext): Promise<void> {
    await this.sessionManager.requireReauthentication(context.sessionId);
    
    await this.notifyUser(context.userId, {
      type: 'reauthentication_required',
      reason: 'Security verification required',
      timestamp: new Date()
    });
  }

  async stopMonitoring(sessionId: string): Promise<void> {
    const interval = this.monitoringIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(sessionId);
    }

    await this.cleanupMonitoringState(sessionId);
  }
}