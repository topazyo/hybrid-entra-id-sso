// src/middleware/MainframeAuthBridge.test.ts
import { MainframeAuthBridge } from './MainframeAuthBridge';
import { AuditLogger, LogProvider, ConsoleLogProvider } from '../services/AuditLogger';
import { AuthenticationChain, AuthRequest, AuthResponse } from '../auth/AuthenticationChain';
import { Request, Response, NextFunction } from 'express'; // For mocking Express objects

// Mock LogProvider
class MockLogProvider implements LogProvider {
  logs: any[] = [];
  info(message: string, meta?: any) { this.logs.push({level: 'info', message, meta}); }
  warn(message: string, meta?: any) { this.logs.push({level: 'warn', message, meta}); }
  error(message: string, meta?: any) { this.logs.push({level: 'error', message, meta}); }
  debug(message: string, meta?: any) { this.logs.push({level: 'debug', message, meta});}
  clearLogs() { this.logs = []; }
}

// Mock AuthenticationChain
class MockAuthChain extends AuthenticationChain {
  private mockResponse: AuthResponse;
  public lastRequest?: AuthRequest;

  constructor(logger: AuditLogger, mockResponse: AuthResponse) {
    super(logger); // Pass logger to parent if it expects one
    this.mockResponse = mockResponse;
  }
  async execute(request: AuthRequest): Promise<AuthResponse> {
    this.lastRequest = request;
    if (this.mockResponse.error && (this.mockResponse.error as any).throw) { // Simulate exception
        throw new Error((this.mockResponse.error as any).message || "Simulated provider exception");
    }
    return Promise.resolve(this.mockResponse);
  }
}


describe('MainframeAuthBridge', () => {
  let mockAuditLogger: AuditLogger;
  let mockLogProvider: MockLogProvider;
  let mockAuthChain: MockAuthChain;
  let bridgeInstance: MainframeAuthBridge;

  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNextFunction: NextFunction;
  let responseStatusSpy: jest.SpyInstance;
  let responseJsonSpy: jest.SpyInstance;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    mockAuditLogger = new AuditLogger(mockLogProvider); // Real AuditLogger with mock provider

    logEventSpy = jest.spyOn(mockAuditLogger, 'logEvent');
    logSystemActivitySpy = jest.spyOn(mockAuditLogger, 'logSystemActivity');

    mockRequest = {
      headers: {},
      ip: '127.0.0.1',
      path: '/protected/resource',
      method: 'GET',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {}, // Initialize locals
    };
    responseStatusSpy = jest.spyOn(mockResponse, 'status');
    responseJsonSpy = jest.spyOn(mockResponse, 'json');
    mockNextFunction = jest.fn();
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
  });

  const setupBridge = (authResponse: AuthResponse) => {
    mockAuthChain = new MockAuthChain(mockAuditLogger, authResponse);
    bridgeInstance = new MainframeAuthBridge(mockAuditLogger, mockAuthChain);
  };

  it('should initialize and log initialization', () => {
    setupBridge({ isAuthenticated: true, userId: 'test' }); // Dummy response for setup
    expect(bridgeInstance).toBeDefined();
    expect(logSystemActivitySpy).toHaveBeenCalledWith('MainframeAuthBridge initialized');
  });

  it('should call next() and set res.locals.authenticatedUser on successful authentication (Basic Auth)', async () => {
    const authUser = 'testUser';
    const authPass = 'password';
    const basicToken = Buffer.from(`${authUser}:${authPass}`).toString('base64');
    mockRequest.headers = { authorization: `Basic ${basicToken}` };

    setupBridge({ isAuthenticated: true, userId: authUser, details: { provider: 'MockProvider' } });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).toHaveBeenCalledTimes(1);
    expect(responseStatusSpy).not.toHaveBeenCalled(); // No error status
    expect(mockResponse.locals.authenticatedUser).toEqual({ id: authUser, details: { provider: 'MockProvider' } });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_SUCCESS',
        expect.objectContaining({ userId: authUser }),
        authUser, '127.0.0.1', 'SUCCESS', expect.any(String)
    );
  });

  it('should return 401 if AuthenticationChain returns failure', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' }; // user:pass
    setupBridge({ isAuthenticated: false, error: 'Mocked auth failure' });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Authentication failed.', details: 'Mocked auth failure' });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_FAILURE',
        expect.objectContaining({ error: 'Mocked auth failure' }),
        'user', '127.0.0.1', 'FAILURE', expect.any(String)
    );
  });

  it('should return 401 if no Authorization header is provided', async () => {
    setupBridge({ isAuthenticated: false }); // AuthChain won't be called
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Authorization header missing.' });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_NO_AUTH_HEADER',
        expect.anything(), undefined, '127.0.0.1', 'FAILURE', expect.any(String)
    );
  });

  it('should return 400 for invalid Basic Authorization header format', async () => {
    mockRequest.headers = { authorization: 'Basic this_is_not_base64_properly' };
    setupBridge({ isAuthenticated: false });
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Invalid Basic Authorization header format.' });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_INVALID_BASIC_HEADER', expect.anything(), undefined, '127.0.0.1', 'FAILURE', expect.any(String));
  });

  it('should return 400 for unsupported Authorization header scheme', async () => {
    mockRequest.headers = { authorization: 'Digest somecredentials' };
    setupBridge({ isAuthenticated: false });
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Unsupported Authorization header scheme.' });
  });

  it('should return 500 if AuthenticationChain throws an exception', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' };
    setupBridge({ isAuthenticated: false, error: { throw: true, message: "Chain exploded" } as any }); // Simulate exception

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(500);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Internal server error during authentication.' });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_EXCEPTION',
        expect.objectContaining({ error: "Chain exploded" }),
        'user', '127.0.0.1', 'FAILURE', expect.any(String)
    );
  });

  it('should correctly parse username from Basic Auth for logging', async () => {
    const authUser = 'specificUser';
    const basicToken = Buffer.from(`${authUser}:test`).toString('base64');
    mockRequest.headers = { authorization: `Basic ${basicToken}` };
    setupBridge({ isAuthenticated: false, error: 'Test' });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    // Check that userIdAttempt in the log was 'specificUser'
    const failureLog = logEventSpy.mock.calls.find(call => call[0] === 'MAINFRAME_AUTH_BRIDGE_FAILURE');
    expect(failureLog).toBeDefined();
    expect(failureLog?.[1].userIdAttempt).toBe(authUser); // Check the logged userIdAttempt
    expect(failureLog?.[2]).toBe(authUser); // Check the userId field in logEvent
  });

});
