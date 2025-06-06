// src/auth/RacfPasswordProvider.test.ts
import { RacfPasswordProvider } from './RacfPasswordProvider';
import { AuthRequest, AuthResponse, AuthError } from './AuthenticationChain';
import { RacfIntegrationService, RacfVerificationResult, RacfUserCredentials } from '../services/RacfIntegrationService';
import { AuditLogger, LogProvider } from '../services/AuditLogger';

// Mock LogProvider
class MockLogProvider implements LogProvider {
  logs: any[] = [];
  info(message: string, meta?: any) { this.logs.push({level: 'info', message, meta}); }
  warn(message: string, meta?: any) { this.logs.push({level: 'warn', message, meta}); }
  error(message: string, meta?: any) { this.logs.push({level: 'error', message, meta}); }
  debug(message: string, meta?: any) { this.logs.push({level: 'debug', message, meta}); }
  clearLogs() { this.logs = []; }
}

// Mock RacfIntegrationService
jest.mock('../services/RacfIntegrationService');
const MockedRacfIntegrationService = RacfIntegrationService as jest.MockedClass<typeof RacfIntegrationService>;

describe('RacfPasswordProvider', () => {
  let provider: RacfPasswordProvider;
  let mockRacfServiceInstance: jest.Mocked<RacfIntegrationService>;
  let mockLogProvider: MockLogProvider;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    mockRacfServiceInstance = new MockedRacfIntegrationService() as jest.Mocked<RacfIntegrationService>;

    // Spy on AuditLogger methods. Provider instantiates its own AuditLogger.
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');

    provider = new RacfPasswordProvider(mockRacfServiceInstance, mockLogProvider);
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
    MockedRacfIntegrationService.mockClear(); // Clear mock instances and calls
  });

  it('getName should return provider name', () => {
    expect(provider.getName()).toBe('RacfPasswordProvider');
  });

  it('should log initialization when constructor is called', () => {
    // The spy is on the prototype, so an instance calling this method will be caught.
    expect(logSystemActivitySpy).toHaveBeenCalledWith('RacfPasswordProvider initialized');
  });

  const baseAuthRequest: Partial<AuthRequest> = {
    correlationId: 'test-corr-id',
    ipAddress: '127.0.0.1',
  };

  it('should return isAuthenticated:false if credentials are not provided or type mismatch', async () => {
    const requestNoCreds: AuthRequest = { ...baseAuthRequest, userId: 'user1' } as AuthRequest;
    let response = await provider.authenticate(requestNoCreds);
    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('INVALID_REQUEST');
    expect(logEventSpy).toHaveBeenCalledWith('RACF_PASSWORD_PROVIDER_AUTH_FAILURE',
        expect.objectContaining({ reason: 'Password credentials not provided or type mismatch.' }),
        'user1', '127.0.0.1', 'FAILURE', 'test-corr-id');

    const requestWrongType: AuthRequest = {
        ...baseAuthRequest,
        userId: 'user2',
        credentials: { type: 'token', token: 'abc' }
    } as AuthRequest;
    response = await provider.authenticate(requestWrongType);
    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('INVALID_REQUEST');
  });

  it('should authenticate successfully if RACF service validates credentials', async () => {
    const request: AuthRequest = {
      ...baseAuthRequest,
      userId: 'testuser',
      credentials: { type: 'password', password: 'goodpassword' },
    } as AuthRequest;
    const racfSuccess: RacfVerificationResult = { isValid: true, userId: 'testuser', groups: ['g1'] };
    mockRacfServiceInstance.verifyCredentials.mockResolvedValue(racfSuccess);

    const response = await provider.authenticate(request);

    expect(response.isAuthenticated).toBe(true);
    expect(response.userId).toBe('testuser');
    expect(response.details?.groups).toEqual(['g1']);
    expect(mockRacfServiceInstance.verifyCredentials).toHaveBeenCalledWith({ userId: 'testuser', password: 'goodpassword' });
    expect(logEventSpy).toHaveBeenCalledWith('RACF_PASSWORD_PROVIDER_AUTH_SUCCESS',
        expect.anything(), 'testuser', '127.0.0.1', 'SUCCESS', 'test-corr-id');
  });

  it('should return failure if RACF service invalidates credentials', async () => {
    const request: AuthRequest = {
      ...baseAuthRequest,
      userId: 'testuser',
      credentials: { type: 'password', password: 'badpassword' },
    } as AuthRequest;
    const racfFailure: RacfVerificationResult = { isValid: false, error: 'Invalid RACF Password' };
    mockRacfServiceInstance.verifyCredentials.mockResolvedValue(racfFailure);

    const response = await provider.authenticate(request);

    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('AUTH_FAILED_RACF');
    expect((response.error as AuthError).originalMessage).toBe('Invalid RACF Password');
    expect(logEventSpy).toHaveBeenCalledWith('RACF_PASSWORD_PROVIDER_AUTH_FAILURE',
        expect.objectContaining({ racfError: 'Invalid RACF Password' }),
        'testuser', '127.0.0.1', 'FAILURE', 'test-corr-id');
  });

  it('should handle exceptions from RACF service', async () => {
    const request: AuthRequest = {
      ...baseAuthRequest,
      userId: 'testuser',
      credentials: { type: 'password', password: 'anypassword' },
    } as AuthRequest;
    mockRacfServiceInstance.verifyCredentials.mockRejectedValue(new Error('RACF Service Down'));

    const response = await provider.authenticate(request);

    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('PROVIDER_EXCEPTION');
    expect((response.error as AuthError).originalMessage).toBe('RACF Service Down');
    expect(logEventSpy).toHaveBeenCalledWith('RACF_PASSWORD_PROVIDER_EXCEPTION',
        expect.objectContaining({ error: 'RACF Service Down' }),
        'testuser', '127.0.0.1', 'FAILURE', 'test-corr-id');
  });
});
