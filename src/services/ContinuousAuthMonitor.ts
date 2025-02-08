import { Logger } from '../utils/Logger';
import { RiskEngine } from '../security/RiskEngine';
import { BehavioralAnalytics } from './BehavioralAnalytics';
import { AlertService } from './AlertService';

interface AuthSession {
  id: string;
  userId: string;
  deviceId: string;
  initialRiskScore: number;
  currentRiskScore: number;
  lastEvaluated: Date;
  status: 'active' | 'suspended' | 'terminated';
}

export class ContinuousAuthMonitor {
  private logger: Logger;
  private riskEngine: RiskEngine;
  private behavioralAnalytics: BehavioralAnalytics;
  private alertService: AlertService;
  private activeSessions: Map<string, AuthSession>;
  private monitoringIntervals: Map<string, NodeJS.Timer>;

  constructor() {
    this.logger = new Logger('ContinuousAuthMonitor');
    this.riskEngine = new RiskEngine();
    this.behavioralAnalytics = new BehavioralAnalytics();
    this.alertService = new AlertService();
    this.activeSessions = new Map();
    this.monitoringIntervals = new Map();
  }

  async startMonitoring(session: AuthSession): Promise<void> {
    try {
      this.activeSessions.set(session.id, session);
      
      const interval = setInterval(
        () => this.evaluateSession(session.id),
        30000 // Check every 30 seconds
      );

      this.monitoringIntervals.set(session.id, interval);
      
      await this.logMonitoringStart(session);
    } catch (error) {
      this.logger.error('Failed to start session monitoring', { session, error });
      throw error;
    }
  }

  private async evaluateSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      const [riskScore, behaviorScore] = await Promise.all([
        this.riskEngine.evaluateRisk({
          userId: session.userId,
          deviceId: session.deviceId,
          timestamp: new Date()
        }),
        this.behavioralAnalytics.analyzeUserBehavior(session.userId)
      ]);

      const combinedScore = this.calculateCombinedScore(riskScore, behaviorScore);
      
      session.currentRiskScore = combinedScore;
      session.lastEvaluated = new Date();

      if (this.requiresAction(session)) {
        await this.handleRiskIncrease(session);
      }
    } catch (error) {
      this.logger.error('Session evaluation failed', { sessionId, error });
      await this.handleEvaluationError(session, error);
    }
  }

  private calculateCombinedScore(
    riskScore: number,
    behaviorScore: number
  ): number {
    return (riskScore * 0.6) + (behaviorScore * 0.4);
  }

  private requiresAction(session: AuthSession): boolean {
    // Check if risk score has increased significantly
    const riskIncrease = session.currentRiskScore - session.initialRiskScore;
    return riskIncrease > 0.3;
  }

  private async handleRiskIncrease(session: AuthSession): Promise<void> {
    if (session.currentRiskScore > 0.8) {
      await this.terminateSession(session.id, 'high_risk');
    } else if (session.currentRiskScore > 0.6) {
      await this.requireReauthentication(session);
    } else {
      await this.increaseMonitering(session);
    }
  }

  private async requireReauthentication(session: AuthSession): Promise<void> {
    session.status = 'suspended';
    
    await this.alertService.sendAlert({
      severity: 'high',
      component: 'ContinuousAuth',
      message: 'Reauthentication required due to increased risk',
      details: {
        sessionId: session.id,
        userId: session.userId,
        currentRiskScore: session.currentRiskScore
      }
    });
  }

  private async increaseMonitering(session: AuthSession): Promise<void> {
    // Increase monitoring frequency
    const currentInterval = this.monitoringIntervals.get(session.id);
    if (currentInterval) {
      clearInterval(currentInterval);
    }

    const newInterval = setInterval(
      () => this.evaluateSession(session.id),
      15000 // Increase to every 15 seconds
    );

    this.monitoringIntervals.set(session.id, newInterval);
  }

  async terminateSession(sessionId: string, reason: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      session.status = 'terminated';
      
      // Clear monitoring interval
      const interval = this.monitoringIntervals.get(sessionId);
      if (interval) {
        clearInterval(interval);
        this.monitoringIntervals.delete(sessionId);
      }

      this.activeSessions.delete(sessionId);

      await this.logSessionTermination(session, reason);
    } catch (error) {
      this.logger.error('Session termination failed', { sessionId, error });
      throw error;
    }
  }

  private async logMonitoringStart(session: AuthSession): Promise<void> {
    this.logger.info('Started continuous authentication monitoring', {
      sessionId: session.id,
      userId: session.userId,
      initialRiskScore: session.initialRiskScore
    });
  }

  private async logSessionTermination(
    session: AuthSession,
    reason: string
  ): Promise<void> {
    this.logger.info('Terminated authentication session', {
      sessionId: session.id,
      userId: session.userId,
      reason,
      finalRiskScore: session.currentRiskScore
    });
  }

  private async handleEvaluationError(
    session: AuthSession,
    error: Error
  ): Promise<void> {
    await this.alertService.sendAlert({
      severity: 'high',
      component: 'ContinuousAuth',
      message: 'Session evaluation failed',
      details: {
        sessionId: session.id,
        userId: session.userId,
        error: error.message
      }
    });
  }
}