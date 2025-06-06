// src/middleware/MainframeAuthBridge.test.ts
import { MainframeAuthBridge } from './MainframeAuthBridge';
import { AuditLogger, LogProvider } from '../services/AuditLogger';
import { AuthenticationChain, AuthRequest, AuthResponse, AuthError } from '../auth/AuthenticationChain'; // Updated imports
import { Request, Response, NextFunction } from 'express';

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
// Re-using a similar mock structure from previous AuthenticationChain tests
class MockAuthChain extends AuthenticationChain {
  private mockResponseGenerator: (request: AuthRequest) => Promise<AuthResponse>;
  public lastRequest?: AuthRequest;

  constructor(logger: AuditLogger, mockResponseGenerator: (request: AuthRequest) => Promise<AuthResponse>) {
    super(logger);
    this.mockResponseGenerator = mockResponseGenerator;
  }

  async execute(request: AuthRequest): Promise<AuthResponse> {
    this.lastRequest = request;
    return this.mockResponseGenerator(request);
  }
}


describe('MainframeAuthBridge with AuthenticationChain', () => {
  let mockAuditLogger: AuditLogger;
  let mockLogProvider: MockLogProvider;
  let mockAuthChain: MockAuthChain; // Changed from RacfService to AuthChain
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
    mockAuditLogger = new AuditLogger(mockLogProvider);

    logEventSpy = jest.spyOn(mockAuditLogger, 'logEvent');
    logSystemActivitySpy = jest.spyOn(mockAuditLogger, 'logSystemActivity');

    // mockAuthChain will be set up in each test or a helper

    mockRequest = {
      headers: {},
      ip: '127.0.0.1',
      path: '/protected/resource',
      method: 'GET',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
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

  // Helper to setup bridge with a specific mock response logic for AuthChain
  const setupBridge = (responseGenerator: (request: AuthRequest) => Promise<AuthResponse>) => {
    mockAuthChain = new MockAuthChain(mockAuditLogger, responseGenerator);
    jest.spyOn(mockAuthChain, 'execute'); // Spy on the execute method of the instance
    bridgeInstance = new MainframeAuthBridge(mockAuditLogger, mockAuthChain);
  };

  it('should initialize and log initialization with AuthenticationChain', () => {
    setupBridge(async () => ({ isAuthenticated: true, userId: 'test' }));
    expect(bridgeInstance).toBeDefined();
    expect(logSystemActivitySpy).toHaveBeenCalledWith('MainframeAuthBridge initialized with AuthenticationChain');
  });

  it('should call authChain.execute and next() on successful Basic Auth', async () => {
    const authUser = 'testUser';
    const authPass = 'password';
    const basicToken = Buffer.from(`${authUser}:${authPass}`).toString('base64');
    mockRequest.headers = { authorization: `Basic ${basicToken}` };

    setupBridge(async (req) => {
      expect(req.credentials?.type).toBe('password');
      expect(req.credentials?.password).toBe(authPass);
      return { isAuthenticated: true, userId: authUser, details: { provider: 'RacfPasswordProvider', groups: ['GRP1'] } };
    });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockAuthChain.execute).toHaveBeenCalledTimes(1);
    const executedAuthRequest = (mockAuthChain.execute as jest.Mock).mock.calls[0][0] as AuthRequest;
    expect(executedAuthRequest.userId).toBe(authUser);
    expect(executedAuthRequest.credentials?.type).toBe('password');
    expect(executedAuthRequest.credentials?.password).toBe(authPass);

    expect(mockNextFunction).toHaveBeenCalledTimes(1);
    expect(mockResponse.locals.authenticatedUser).toEqual({ id: authUser, groups: ['GRP1'], authDetails: { provider: 'RacfPasswordProvider', groups: ['GRP1'] } });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_SUCCESS', expect.anything(), authUser, '127.0.0.1', 'SUCCESS', expect.any(String));
  });

  it('should call authChain.execute and next() on successful Bearer token Auth', async () => {
    const token = 'valid-sample-token';
    mockRequest.headers = { authorization: `Bearer ${token}` };

    setupBridge(async (req) => {
        expect(req.credentials?.type).toBe('token');
        expect(req.credentials?.token).toBe(token);
        return { isAuthenticated: true, userId: 'tokenUser123', details: { provider: 'SomeTokenProvider', scope: 'read' } };
    });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockAuthChain.execute).toHaveBeenCalledTimes(1);
    const executedAuthRequest = (mockAuthChain.execute as jest.Mock).mock.calls[0][0] as AuthRequest;
    expect(executedAuthRequest.credentials?.type).toBe('token');
    expect(executedAuthRequest.credentials?.token).toBe(token);

    expect(mockNextFunction).toHaveBeenCalledTimes(1);
    expect(mockResponse.locals.authenticatedUser).toEqual({ id: 'tokenUser123', groups: undefined, authDetails: { provider: 'SomeTokenProvider', scope: 'read' } });
  });

  it('should return 401 if authChain.execute returns isAuthenticated:false', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' }; // user:pass
    const authChainFailureResponse: AuthResponse = { isAuthenticated: false, error: {code: 'CHAIN_FAILURE', message:'Auth chain failed'} };
    setupBridge(async () => authChainFailureResponse);

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Authentication failed.', details: authChainFailureResponse.error });
  });

  it('should return 500 if authChain.execute throws an exception', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' };
    setupBridge(async () => { throw new Error("Chain execution exploded"); });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(500);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Internal server error during authentication chain processing.' });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_CHAIN_EXCEPTION',
        expect.objectContaining({ error: "Chain execution exploded" }),
        'user', // userIdAttempt from Basic Auth
        '127.0.0.1', 'FAILURE', expect.any(String)
    );
  });

  // Standard header validation tests
  it('should return 401 if no Authorization header is provided', async () => {
    setupBridge(async () => ({ isAuthenticated: false })); // AuthChain won't be called
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(mockAuthChain.execute).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
  });

  it('should return 400 for invalid Basic Authorization header format', async () => {
    mockRequest.headers = { authorization: 'Basic this_is_not_base64_properly' };
    setupBridge(async () => ({ isAuthenticated: false }));
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(mockAuthChain.execute).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
  });

  it('should return 400 for unsupported Authorization header scheme', async () => {
    mockRequest.headers = { authorization: 'Digest somecredentials' };
    setupBridge(async () => ({ isAuthenticated: false }));
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(mockAuthChain.execute).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
  });
});
