// src/middleware/MainframeAuthBridge.test.ts
import { MainframeAuthBridge } from './MainframeAuthBridge';
import { AuditLogger, LogProvider } from '../services/AuditLogger';
import { AuthenticationChain, AuthRequest, AuthResponse, AuthError } from '../auth/AuthenticationChain';
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
    mockAuditLogger = new AuditLogger(mockLogProvider);

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

  const setupBridge = (responseGenerator: (request: AuthRequest) => Promise<AuthResponse>) => {
    mockAuthChain = new MockAuthChain(mockAuditLogger, responseGenerator);
    jest.spyOn(mockAuthChain, 'execute');
    bridgeInstance = new MainframeAuthBridge(mockAuditLogger, mockAuthChain);
  };

  it('should initialize and log initialization with AuthenticationChain', () => {
    setupBridge(async () => ({ isAuthenticated: true, userId: 'test' }));
    expect(bridgeInstance).toBeDefined();
    expect(logSystemActivitySpy).toHaveBeenCalledWith('MainframeAuthBridge initialized with AuthenticationChain');
  });

  it('should call authChain.execute with correct Basic Auth credentials', async () => {
    const authUser = 'testUser';
    const authPass = 'password';
    const basicToken = Buffer.from(`${authUser}:${authPass}`).toString('base64');
    mockRequest.headers = { authorization: `Basic ${basicToken}` };

    setupBridge(async (req) => {
      expect(req.userId).toBe(authUser);
      expect(req.credentials?.type).toBe('password');
      expect(req.credentials?.password).toBe(authPass);
      expect(req.credentials?.token).toBeUndefined();
      return { isAuthenticated: true, userId: authUser, details: { provider: 'RacfPasswordProvider', groups: ['GRP1'] } };
    });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockAuthChain.execute).toHaveBeenCalledTimes(1);
    expect(mockNextFunction).toHaveBeenCalledTimes(1);
    expect(mockResponse.locals.authenticatedUser).toEqual({ id: authUser, groups: ['GRP1'], authDetails: { provider: 'RacfPasswordProvider', groups: ['GRP1'] } });
  });

  it('should call authChain.execute with correct Bearer token credentials', async () => {
    const token = 'valid-sample-token';
    mockRequest.headers = { authorization: `Bearer ${token}` };

    setupBridge(async (req) => {
        expect(req.userId).toBe('token_holder'); // Placeholder from bridge
        expect(req.credentials?.type).toBe('token');
        expect(req.credentials?.token).toBe(token);
        expect(req.credentials?.password).toBeUndefined();
        return { isAuthenticated: true, userId: 'actualTokenUser', details: { provider: 'BearerTokenAuthProvider', scope: 'read' } };
    });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockAuthChain.execute).toHaveBeenCalledTimes(1);
    expect(mockNextFunction).toHaveBeenCalledTimes(1);
    expect(mockResponse.locals.authenticatedUser).toEqual({ id: 'actualTokenUser', groups: undefined, authDetails: { provider: 'BearerTokenAuthProvider', scope: 'read' } });
  });

  it('should return 400 if Basic Auth decoding results in no username', async () => {
    const basicToken = Buffer.from(`:${"password"}`).toString('base64'); // No username
    mockRequest.headers = { authorization: `Basic ${basicToken}` };
    setupBridge(async () => ({ isAuthenticated: false }));

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
    expect(responseJsonSpy).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid Basic Authorization header format.' }));
  });

  it('should return 400 if Bearer token is empty after "Bearer " prefix', async () => {
    mockRequest.headers = { authorization: 'Bearer ' }; // Empty token
    setupBridge(async () => ({ isAuthenticated: false }));

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
    expect(responseJsonSpy).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid Bearer token: token string is empty.' }));
  });


  it('should return 401 if authChain.execute returns isAuthenticated:false', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' };
    const authChainFailureResponse: AuthResponse = { isAuthenticated: false, error: {code: 'CHAIN_FAILURE', message:'Auth chain failed'} };
    setupBridge(async () => authChainFailureResponse);

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
  });

  it('should return 500 if authChain.execute throws an exception', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' };
    setupBridge(async () => { throw new Error("Chain execution exploded"); });

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(500);
  });

  it('should return 401 if no Authorization header is provided', async () => {
    setupBridge(async () => ({ isAuthenticated: false }));
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(mockAuthChain.execute).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
  });

  it('should return 400 for invalid Basic Authorization header format (unparseable)', async () => {
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
