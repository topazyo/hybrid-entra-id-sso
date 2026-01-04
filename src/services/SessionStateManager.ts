import { Logger } from '../../utils/Logger';
import { CacheManager } from './CacheManager';
import { AuditLogger } from './AuditLogger';
import { generateId } from '../../utils/IdGenerator';
import * as http from 'http';
import * as https from 'https';

interface MainframeSession {
  sessionId: string;
  userId: string;
  mainframeId: string;
  created: Date;
  lastAccessed: Date;
  state: 'active' | 'inactive' | 'terminated';
}

export class SessionStateManager {
  private logger: Logger;
  private cache: CacheManager;
  private auditLogger: AuditLogger;
  private healthCheck?: NodeJS.Timer;
  private activeSessionIds: Set<string>;
  private heartbeatTTLSeconds: number;
  private maxIdleSeconds: number;
  private healthProbeTimeoutMs: number;
  private healthCheckEnabled: boolean;
  private healthCheckMethod: 'HEAD' | 'GET';
  private healthCheckExpectedStatuses: Set<number>;
  private healthCheckUrl?: string;
  private healthCheckUrlObject?: URL;
  private healthProbe: (session: MainframeSession) => Promise<boolean>;
  private httpRequestImpl: typeof http.request;
  private httpsRequestImpl: typeof https.request;

  constructor(options?: {
    healthProbe?: (session: MainframeSession) => Promise<boolean>;
    httpRequest?: typeof http.request;
    httpsRequest?: typeof https.request;
  }) {
    this.logger = new Logger('SessionStateManager');
    this.cache = new CacheManager();
    this.auditLogger = new AuditLogger();
    this.activeSessionIds = new Set<string>();
    this.heartbeatTTLSeconds = this.parseNumberEnv(process.env.MAINFRAME_SESSION_TTL_SECONDS, 300);
    this.maxIdleSeconds = this.parseNumberEnv(process.env.MAINFRAME_SESSION_IDLE_SECONDS, 900);
    this.healthProbeTimeoutMs = this.parseNumberEnv(process.env.MAINFRAME_HEALTHCHECK_TIMEOUT_MS, 3000);
    this.healthCheckEnabled = this.parseBooleanEnv(process.env.MAINFRAME_HEALTHCHECK_ENABLED, true);
    this.healthCheckMethod = this.parseHealthCheckMethod(process.env.MAINFRAME_HEALTHCHECK_METHOD);
    this.healthCheckExpectedStatuses = this.parseStatusCodes(process.env.MAINFRAME_HEALTHCHECK_EXPECTED_STATUSES);
    this.healthCheckUrl = process.env.MAINFRAME_HEALTHCHECK_URL;
    this.healthCheckUrlObject = this.healthCheckUrl ? new URL(this.healthCheckUrl) : undefined;
    this.validateHealthCheckConfiguration(Boolean(options?.healthProbe));
    this.healthProbe = options?.healthProbe || this.defaultHealthProbe;
    this.httpRequestImpl = options?.httpRequest || http.request;
    this.httpsRequestImpl = options?.httpsRequest || https.request;
    this.initializeHealthCheck();
  }

  private parseNumberEnv(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(normalized);
  }

  private parseHealthCheckMethod(value: string | undefined): 'HEAD' | 'GET' {
    const normalized = value ? value.toUpperCase() : undefined;
    return normalized === 'GET' ? 'GET' : 'HEAD';
  }

  private parseStatusCodes(value: string | undefined): Set<number> {
    if (!value) {
      return new Set([200, 201, 202, 204, 301, 302, 307, 308]);
    }

    const codes = value
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0);

    return new Set(codes.length > 0 ? codes : [200, 201, 202, 204, 301, 302, 307, 308]);
  }

  private validateHealthCheckConfiguration(customProbeProvided: boolean): void {
    if (!this.healthCheckEnabled) return;

    const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const hasUrl = Boolean(this.healthCheckUrlObject);

    if (isProduction && !hasUrl && !customProbeProvided) {
      throw new Error('MAINFRAME_HEALTHCHECK_URL must be set or a custom healthProbe provided when health checks are enabled in production');
    }

    if (!hasUrl && !customProbeProvided) {
      this.logger.warn('Health check enabled without MAINFRAME_HEALTHCHECK_URL; default probe will noop. Set the URL or supply a custom healthProbe.');
    }
  }

  private initializeHealthCheck(): void {
    this.healthCheck = setInterval(
      () => this.validateSessions(),
      60000 // Check every minute
    );
  }

  async createSession(
    user: string,
    mainframeSession: any
  ): Promise<string> {
    const sessionId = generateId('session');
    
    const session: MainframeSession = {
      sessionId,
      userId: user,
      mainframeId: mainframeSession.id,
      created: new Date(),
      lastAccessed: new Date(),
      state: 'active'
    };

    this.cache.set(`session:${sessionId}`, session);
    this.cache.set(`session:${sessionId}:heartbeat`, Date.now(), this.heartbeatTTLSeconds);
    this.activeSessionIds.add(sessionId);
    await this.logSessionEvent('created', session);

    return sessionId;
  }

  async validateSession(sessionId: string): Promise<boolean> {
    const session = this.cache.get<MainframeSession>(`session:${sessionId}`);
    if (!session) return false;

    const isMainframeActive = await this.checkMainframeSession(session);
    if (!isMainframeActive) {
      await this.terminateSession(sessionId, 'mainframe_disconnected');
      return false;
    }

    session.lastAccessed = new Date();
    this.cache.set(`session:${sessionId}`, session);
    this.cache.set(`session:${sessionId}:heartbeat`, Date.now(), this.heartbeatTTLSeconds);
    return true;
  }

  async terminateSession(sessionId: string, reason: string): Promise<void> {
    const session = this.cache.get<MainframeSession>(`session:${sessionId}`);
    if (!session) {
      this.logger.warn('Terminate requested for unknown session', { sessionId, reason });
      return;
    }

    session.state = 'terminated';
    session.lastAccessed = new Date();

    this.cache.del(`session:${sessionId}`);
    this.activeSessionIds.delete(sessionId);

    await this.logSessionEvent('terminated', session);
    await this.logger.info('Session terminated', { sessionId, reason });
  }

  private async validateSessions(): Promise<void> {
    const sessions = await this.getAllActiveSessions();
    
    for (const session of sessions) {
      try {
        const isValid = await this.validateSession(session.sessionId);
        if (!isValid) {
          await this.terminateSession(session.sessionId, 'validation_failed');
        }
      } catch (error) {
        this.logger.error('Session validation failed', { session, error });
      }
    }
  }
  async getAllActiveSessions(): Promise<MainframeSession[]> {
    const sessions: MainframeSession[] = [];
    for (const sessionId of this.activeSessionIds) {
      const session = this.cache.get<MainframeSession>(`session:${sessionId}`);
      if (session && session.state === 'active') {
        sessions.push(session);
      } else {
        this.activeSessionIds.delete(sessionId);
      }
    }
    return sessions;
  }

  private async checkMainframeSession(session: MainframeSession): Promise<boolean> {
    const heartbeatKey = `session:${session.sessionId}:heartbeat`;
    const now = Date.now();
    const lastHeartbeat = this.cache.get<number>(heartbeatKey);
    const lastAccessed = session.lastAccessed instanceof Date
      ? session.lastAccessed.getTime()
      : new Date(session.lastAccessed).getTime();

    const heartbeatStale = !lastHeartbeat || now - lastHeartbeat > this.heartbeatTTLSeconds * 1000;
    const accessStale = this.maxIdleSeconds > 0 && lastAccessed ? now - lastAccessed > this.maxIdleSeconds * 1000 : false;

    if (heartbeatStale || accessStale) {
      this.auditLogger.logEvent(
        'SessionHealthCheckFailed',
        {
          resourceId: session.mainframeId,
          action: 'health_check',
          sessionId: session.sessionId,
          heartbeatStale,
          accessStale,
          lastHeartbeat,
          lastAccessed: session.lastAccessed
        },
        session.userId,
        undefined,
        'FAILURE'
      );
      return false;
    }

    const probeHealthy = await this.healthProbe(session);
    if (!probeHealthy) {
      this.auditLogger.logEvent(
        'SessionHealthCheckFailed',
        {
          resourceId: session.mainframeId,
          action: 'health_check_probe',
          sessionId: session.sessionId,
          heartbeatStale: false,
          accessStale: false,
          healthEndpoint: this.healthCheckUrl
        },
        session.userId,
        undefined,
        'FAILURE'
      );
      return false;
    }

    this.cache.set(heartbeatKey, now, this.heartbeatTTLSeconds);
    return true;
  }

  private async defaultHealthProbe(session: MainframeSession): Promise<boolean> {
    if (!this.healthCheckEnabled) return true;
    if (!this.healthCheckUrlObject) return true;
    try {
      const target = this.healthCheckUrlObject;
      const client = target.protocol === 'http:' ? this.httpRequestImpl : this.httpsRequestImpl;

      const result = await new Promise<boolean>((resolve) => {
        const req = client(
          target,
          {
            method: this.healthCheckMethod,
            timeout: this.healthProbeTimeoutMs,
            headers: {
              'x-mainframe-session-id': session.sessionId,
              'x-mainframe-id': session.mainframeId,
              'x-user-id': session.userId
            }
          },
          (res) => {
            res.resume();
            const status = res.statusCode ?? 0;
            const ok = this.healthCheckExpectedStatuses.has(status) || (status >= 200 && status < 400);
            resolve(ok);
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.on('error', () => resolve(false));
        req.end();
      });

      if (!result) {
        await this.logger.warn('Mainframe health probe returned unhealthy', { sessionId: session.sessionId, mainframeId: session.mainframeId, url: this.healthCheckUrl });
      }
      return result;
    } catch (error) {
      await this.logger.warn('Mainframe health probe failed', { sessionId: session.sessionId, mainframeId: session.mainframeId, url: this.healthCheckUrl, error });
      return false;
    }
  }

  private async logSessionEvent(
    event: string,
    session: MainframeSession
  ): Promise<void> {
    this.auditLogger.logEvent(
      'SessionStateChange',
      {
        resourceId: session.mainframeId,
        action: event,
        sessionId: session.sessionId,
        state: session.state,
        created: session.created,
        lastAccessed: session.lastAccessed
      },
      session.userId,
      undefined,
      'SUCCESS'
    );
  }
}