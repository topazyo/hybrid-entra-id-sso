// src/middleware/MainframeAuthBridge.test.ts
import { MainframeAuthBridge } from './MainframeAuthBridge';
import { AuditLogger, LogProvider } from '../services/AuditLogger'; // Removed ConsoleLogProvider, using Mock
import { RacfIntegrationService, RacfVerificationResult, RacfUserCredentials } from '../services/RacfIntegrationService';
import { Request, Response, NextFunction } from 'express';

// Mock LogProvider (as before)
class MockLogProvider implements LogProvider {
  logs: any[] = [];
  info(message: string, meta?: any) { this.logs.push({level: 'info', message, meta}); }
  warn(message: string, meta?: any) { this.logs.push({level: 'warn', message, meta}); }
  error(message: string, meta?: any) { this.logs.push({level: 'error', message, meta}); }
  debug(message: string, meta?: any) { this.logs.push({level: 'debug', message, meta});}
  clearLogs() { this.logs = []; }
}

// Mock RacfIntegrationService
jest.mock('../services/RacfIntegrationService'); // Auto-mock the service
const MockedRacfIntegrationService = RacfIntegrationService as jest.MockedClass<typeof RacfIntegrationService>;


describe('MainframeAuthBridge with RacfIntegrationService', () => {
  let mockAuditLogger: AuditLogger;
  let mockLogProvider: MockLogProvider;
  let mockRacfServiceInstance: jest.Mocked<RacfIntegrationService>;
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

    MockedRacfIntegrationService.mockClear();
    mockRacfServiceInstance = new MockedRacfIntegrationService() as jest.Mocked<RacfIntegrationService>;

    bridgeInstance = new MainframeAuthBridge(mockAuditLogger, mockRacfServiceInstance);

    mockRequest = { headers: {}, ip: '127.0.0.1', path: '/protected/resource', method: 'GET' };
    mockResponse = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), locals: {} };
    responseStatusSpy = jest.spyOn(mockResponse, 'status');
    responseJsonSpy = jest.spyOn(mockResponse, 'json');
    mockNextFunction = jest.fn();
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
  });

  it('should initialize and log initialization with RacfIntegrationService', () => {
    expect(bridgeInstance).toBeDefined();
    expect(logSystemActivitySpy).toHaveBeenCalledWith('MainframeAuthBridge initialized with RacfIntegrationService');
  });


  it('should call racfService.verifyCredentials and next() on successful Basic Auth', async () => {
    const authUser = 'testracfuser';
    const authPass = 'racfpassword';
    const basicToken = Buffer.from(`${authUser}:${authPass}`).toString('base64');
    mockRequest.headers = { authorization: `Basic ${basicToken}` };

    const racfSuccessResponse: RacfVerificationResult = { isValid: true, userId: authUser, groups: ['GRP1'] };
    mockRacfServiceInstance.verifyCredentials.mockResolvedValue(racfSuccessResponse);

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockRacfServiceInstance.verifyCredentials).toHaveBeenCalledWith({ userId: authUser, password: authPass, token: undefined });
    expect(mockNextFunction).toHaveBeenCalledTimes(1);
    expect(mockResponse.locals.authenticatedUser).toEqual({ id: authUser, groups: ['GRP1'], authDetails: undefined });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_SUCCESS', expect.anything(), authUser, '127.0.0.1', 'SUCCESS', expect.any(String));
  });

  it('should call racfService.verifyCredentials and next() on successful Bearer token Auth', async () => {
    const token = 'valid-racf-token';
    mockRequest.headers = { authorization: `Bearer ${token}` };

    const racfSuccessResponse: RacfVerificationResult = { isValid: true, userId: 'tokenuser', groups: ['TOKENGRP'] };
    mockRacfServiceInstance.verifyCredentials.mockResolvedValue(racfSuccessResponse);

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockRacfServiceInstance.verifyCredentials).toHaveBeenCalledWith({ userId: 'tokenuser', password: undefined, token: token });
    expect(mockNextFunction).toHaveBeenCalledTimes(1);
    expect(mockResponse.locals.authenticatedUser).toEqual({ id: 'tokenuser', groups: ['TOKENGRP'], authDetails: undefined });
  });

  it('should return 401 if racfService.verifyCredentials returns isValid:false', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' }; // user:pass
    const racfFailureResponse: RacfVerificationResult = { isValid: false, error: 'RACF Auth Failed' };
    mockRacfServiceInstance.verifyCredentials.mockResolvedValue(racfFailureResponse);

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Authentication failed.', details: 'RACF Auth Failed' });
  });

  it('should return 500 if racfService.verifyCredentials throws an exception', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' };
    mockRacfServiceInstance.verifyCredentials.mockRejectedValue(new Error("RACF Service Unavailable"));

    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);

    expect(mockNextFunction).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(500);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Internal server error during authentication.' });
    expect(logEventSpy).toHaveBeenCalledWith('MAINFRAME_AUTH_BRIDGE_EXCEPTION',
        expect.objectContaining({ error: "RACF Service Unavailable" }),
        'user', '127.0.0.1', 'FAILURE', expect.any(String)
    );
  });

  // Tests for missing header, invalid header format, unsupported scheme remain important
  it('should return 401 if no Authorization header is provided', async () => {
    // No setup for mockRacfServiceInstance.verifyCredentials as it shouldn't be called
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(mockRacfServiceInstance.verifyCredentials).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(401);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Authorization header missing.' });
  });

  it('should return 400 for invalid Basic Authorization header format', async () => {
    mockRequest.headers = { authorization: 'Basic this_is_not_base64_properly' };
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(mockRacfServiceInstance.verifyCredentials).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Invalid Basic Authorization header format.' });
  });

  it('should return 400 for unsupported Authorization header scheme', async () => {
    mockRequest.headers = { authorization: 'Digest somecredentials' };
    await bridgeInstance.bridge(mockRequest as Request, mockResponse as Response, mockNextFunction);
    expect(mockRacfServiceInstance.verifyCredentials).not.toHaveBeenCalled();
    expect(responseStatusSpy).toHaveBeenCalledWith(400);
    expect(responseJsonSpy).toHaveBeenCalledWith({ error: 'Unsupported Authorization header scheme.' });
  });
});
