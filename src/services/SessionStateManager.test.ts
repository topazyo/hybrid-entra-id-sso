import { SessionStateManager } from './SessionStateManager';
import { AuditLogger } from './AuditLogger';

describe('SessionStateManager health checks', () => {
  let manager: SessionStateManager;
  let logEventSpy: jest.SpyInstance;
  let healthProbeMock: jest.Mock;

  const withSession = async () => {
    const sessionId = await manager.createSession('user1', { id: 'mf-1' });
    const cache = (manager as any).cache as any;
    return { sessionId, cache };
  };

  beforeEach(() => {
    healthProbeMock = jest.fn().mockResolvedValue(true);
    logEventSpy = jest.spyOn(AuditLogger.prototype as any, 'logEvent');
    manager = new SessionStateManager({ healthProbe: healthProbeMock });
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    const interval = (manager as any).healthCheck as NodeJS.Timer | undefined;
    if (interval) {
      clearInterval(interval as any);
    }
  });

  it('terminates sessions when heartbeat is stale', async () => {
    const { sessionId, cache } = await withSession();
    (manager as any).heartbeatTTLSeconds = 1;
    (manager as any).maxIdleSeconds = 9999;
    cache.set(`session:${sessionId}:heartbeat`, Date.now() - 2000);

    const valid = await manager.validateSession(sessionId);
    expect(valid).toBe(false);

    const remaining = await manager.getAllActiveSessions();
    expect(remaining).toHaveLength(0);

    const hadHealthFailure = logEventSpy.mock.calls.some(([eventType, details]) => eventType === 'SessionHealthCheckFailed' && details?.heartbeatStale === true);
    expect(hadHealthFailure).toBe(true);
  });

  it('terminates sessions when idle time exceeds threshold', async () => {
    const { sessionId, cache } = await withSession();
    (manager as any).heartbeatTTLSeconds = 9999;
    (manager as any).maxIdleSeconds = 1;

    const session = cache.get(`session:${sessionId}`);
    session.lastAccessed = new Date(Date.now() - 2000);
    cache.set(`session:${sessionId}`, session);

    const valid = await manager.validateSession(sessionId);
    expect(valid).toBe(false);

    const remaining = await manager.getAllActiveSessions();
    expect(remaining).toHaveLength(0);

    const hadIdleFailure = logEventSpy.mock.calls.some(([eventType, details]) => eventType === 'SessionHealthCheckFailed' && details?.accessStale === true);
    expect(hadIdleFailure).toBe(true);
  });

  it('terminates sessions when health probe reports failure', async () => {
    healthProbeMock.mockResolvedValueOnce(false);
    const { sessionId } = await withSession();
    (manager as any).heartbeatTTLSeconds = 9999;
    (manager as any).maxIdleSeconds = 9999;

    const valid = await manager.validateSession(sessionId);
    expect(valid).toBe(false);
    expect(healthProbeMock).toHaveBeenCalledTimes(1);

    const remaining = await manager.getAllActiveSessions();
    expect(remaining).toHaveLength(0);

    const hadProbeFailure = logEventSpy.mock.calls.some(([eventType, details]) => eventType === 'SessionHealthCheckFailed' && details?.action === 'health_check_probe');
    expect(hadProbeFailure).toBe(true);
  });
});

describe('SessionStateManager default health probe', () => {
  const originalEnv = { ...process.env };

  const buildSession = () => ({
    sessionId: 'session-123',
    userId: 'user-123',
    mainframeId: 'mf-123',
    created: new Date(),
    lastAccessed: new Date(),
    state: 'active' as const
  });

  const mockHttpRequest = (statusCode: number, endBehavior: 'success' | 'error' | 'timeout' = 'success') => {
    const handlers: Record<string, Function> = {};
    let callbackFn: Function | undefined;
    const req = {
      on: jest.fn((event: string, handler: Function) => {
        handlers[event] = handler;
        return req;
      }),
      end: jest.fn(() => {
        if (endBehavior === 'success' && callbackFn) {
          callbackFn({ statusCode, resume: jest.fn() });
        }
        if (endBehavior === 'error' && handlers['error']) handlers['error'](new Error('probe failure'));
        if (endBehavior === 'timeout' && handlers['timeout']) handlers['timeout']();
      }),
      destroy: jest.fn()
    } as any;

    const spy = jest.fn((_url: any, _options: any, callback: any) => {
      callbackFn = callback;
      return req;
    });

    return { spy, req };
  };

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws in production when enabled and no URL or custom probe', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MAINFRAME_HEALTHCHECK_URL;
    process.env.MAINFRAME_HEALTHCHECK_ENABLED = 'true';

    expect(() => new SessionStateManager()).toThrow('MAINFRAME_HEALTHCHECK_URL');
  });

  it('skips probe when disabled', async () => {
    process.env.MAINFRAME_HEALTHCHECK_ENABLED = 'false';
    process.env.MAINFRAME_HEALTHCHECK_URL = 'http://example.com/health';

    const manager = new SessionStateManager();
    const result = await (manager as any).defaultHealthProbe(buildSession());
    expect(result).toBe(true);

    const interval = (manager as any).healthCheck as NodeJS.Timer | undefined;
    if (interval) clearInterval(interval as any);
  });

  it('treats configured success codes as healthy', async () => {
    process.env.MAINFRAME_HEALTHCHECK_URL = 'http://example.com/health';
    process.env.MAINFRAME_HEALTHCHECK_EXPECTED_STATUSES = '200,204';
    const { spy } = mockHttpRequest(204);

    const manager = new SessionStateManager({ httpRequest: spy as any });
    const result = await (manager as any).defaultHealthProbe(buildSession());

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalled();

    const interval = (manager as any).healthCheck as NodeJS.Timer | undefined;
    if (interval) clearInterval(interval as any);
  });

  it('treats unexpected status as unhealthy', async () => {
    process.env.MAINFRAME_HEALTHCHECK_URL = 'http://example.com/health';
    process.env.MAINFRAME_HEALTHCHECK_EXPECTED_STATUSES = '200,204';
    const { spy } = mockHttpRequest(503);

    const manager = new SessionStateManager({ httpRequest: spy as any });
    const result = await (manager as any).defaultHealthProbe(buildSession());

    expect(result).toBe(false);
    expect(spy).toHaveBeenCalled();

    const interval = (manager as any).healthCheck as NodeJS.Timer | undefined;
    if (interval) clearInterval(interval as any);
  });

  it('returns unhealthy on timeout/error', async () => {
    process.env.MAINFRAME_HEALTHCHECK_URL = 'http://example.com/health';
    const { spy } = mockHttpRequest(200, 'timeout');

    const manager = new SessionStateManager({ httpRequest: spy as any });
    const result = await (manager as any).defaultHealthProbe(buildSession());

    expect(result).toBe(false);
    expect(spy).toHaveBeenCalled();

    const interval = (manager as any).healthCheck as NodeJS.Timer | undefined;
    if (interval) clearInterval(interval as any);
  });
});
