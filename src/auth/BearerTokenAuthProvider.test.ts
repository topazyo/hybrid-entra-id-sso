// src/auth/BearerTokenAuthProvider.test.ts
import { BearerTokenAuthProvider } from './BearerTokenAuthProvider';
import { AuthRequest, AuthResponse, AuthError } from './AuthenticationChain';
import { AccessTokenService, VerificationResult, TokenClaims } from '../services/AccessTokenService';
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

// Mock AccessTokenService
jest.mock('../services/AccessTokenService');
const MockedAccessTokenService = AccessTokenService as jest.MockedClass<typeof AccessTokenService>;

describe('BearerTokenAuthProvider', () => {
  let provider: BearerTokenAuthProvider;
  let mockAccessTokenServiceInstance: jest.Mocked<AccessTokenService>;
  let mockLogProvider: MockLogProvider;
  let logEventSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    mockAccessTokenServiceInstance = new MockedAccessTokenService() as jest.Mocked<AccessTokenService>;

    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    jest.spyOn(AuditLogger.prototype, 'logSystemActivity'); // Ensure constructor log doesn't fail if not spied

    provider = new BearerTokenAuthProvider(mockAccessTokenServiceInstance, mockLogProvider);
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    jest.spyOn(AuditLogger.prototype, 'logSystemActivity').mockRestore();
    mockLogProvider.clearLogs();
    MockedAccessTokenService.mockClear();
  });

  it('getName should return provider name', () => {
    expect(provider.getName()).toBe('BearerTokenAuthProvider');
  });

  const baseAuthRequest: Partial<AuthRequest> = {
    correlationId: 'test-corr-id-token',
    ipAddress: '192.168.0.1',
  };

  it('should return isAuthenticated:false if credentials.type is not "token"', async () => {
    const request: AuthRequest = {
        ...baseAuthRequest,
        userId: 'user1',
        credentials: { type: 'password', password: 'abc' }
    } as AuthRequest;
    const response = await provider.authenticate(request);
    expect(response.isAuthenticated).toBe(false);
    // No error should be set by this provider if type doesn't match, allows chain to continue
    expect(response.error).toBeUndefined();
    // Check that it logged an attempt but didn't proceed further with token logic
    expect(logEventSpy).toHaveBeenCalledWith('BEARER_TOKEN_PROVIDER_AUTH_ATTEMPT', expect.anything(), expect.anything(), expect.anything(), 'PENDING', expect.anything());
    expect(mockAccessTokenServiceInstance.verifyToken).not.toHaveBeenCalled();
  });

  it('should return isAuthenticated:false with error if credentials.type is "token" but token is missing', async () => {
    const request: AuthRequest = {
        ...baseAuthRequest,
        userId: 'user1',
        credentials: { type: 'token' } // Token string is missing
    } as AuthRequest;
    const response = await provider.authenticate(request);
    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('INVALID_REQUEST_TOKEN_MISSING');
  });

   it('should return isAuthenticated:false with error if no credentials provided', async () => {
    const request: AuthRequest = { ...baseAuthRequest, userId: 'user1' } as AuthRequest; // No credentials object
    const response = await provider.authenticate(request);
    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('NO_TOKEN_CREDENTIALS');
  });


  it('should authenticate successfully if AccessTokenService validates the token', async () => {
    const token = 'valid.mock.token';
    const request: AuthRequest = {
      ...baseAuthRequest,
      userId: 'initialUser', // This might be different from token's subject
      credentials: { type: 'token', token },
    } as AuthRequest;
    const serviceSuccess: VerificationResult = { isValid: true, userId: 'tokenSubjectUser', claims: { scope: 'read_data' } };
    mockAccessTokenServiceInstance.verifyToken.mockResolvedValue(serviceSuccess);

    const response = await provider.authenticate(request);

    expect(response.isAuthenticated).toBe(true);
    expect(response.userId).toBe('tokenSubjectUser'); // UserID from token is authoritative
    expect(response.details?.provider).toBe('BearerTokenAuthProvider');
    expect(response.details?.claims?.scope).toBe('read_data');
    expect(mockAccessTokenServiceInstance.verifyToken).toHaveBeenCalledWith(token);
    expect(logEventSpy).toHaveBeenCalledWith('BEARER_TOKEN_PROVIDER_AUTH_SUCCESS',
        expect.objectContaining({ userId: 'tokenSubjectUser', tokenUserId: 'tokenSubjectUser', requestUserId: 'initialUser' }),
        'tokenSubjectUser', '192.168.0.1', 'SUCCESS', 'test-corr-id-token');
  });

  it('should return failure if AccessTokenService invalidates the token', async () => {
    const token = 'invalid.mock.token';
    const request: AuthRequest = {
      ...baseAuthRequest,
      userId: 'testuser',
      credentials: { type: 'token', token },
    } as AuthRequest;
    const serviceFailure: VerificationResult = { isValid: false, error: 'token_expired', userId: 'testuserFromExpiredToken' };
    mockAccessTokenServiceInstance.verifyToken.mockResolvedValue(serviceFailure);

    const response = await provider.authenticate(request);

    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('TOKEN_VERIFICATION_FAILED_TOKEN_EXPIRED');
    expect((response.error as AuthError).message).toBe('token_expired');
    expect(response.details?.tokenUserId).toBe('testuserFromExpiredToken');
    expect(logEventSpy).toHaveBeenCalledWith('BEARER_TOKEN_PROVIDER_AUTH_FAILURE',
        expect.objectContaining({ verificationError: 'token_expired' }),
        'testuser', // request.userId or tokenUserId if available
        '192.168.0.1', 'FAILURE', 'test-corr-id-token');
  });

  it('should handle exceptions from AccessTokenService', async () => {
    const token = 'error.inducing.token';
    const request: AuthRequest = {
      ...baseAuthRequest,
      userId: 'testuser',
      credentials: { type: 'token', token },
    } as AuthRequest;
    mockAccessTokenServiceInstance.verifyToken.mockRejectedValue(new Error('Service unavailable'));

    const response = await provider.authenticate(request);

    expect(response.isAuthenticated).toBe(false);
    expect((response.error as AuthError).code).toBe('PROVIDER_EXCEPTION');
    expect((response.error as AuthError).originalMessage).toBe('Service unavailable');
    expect(logEventSpy).toHaveBeenCalledWith('BEARER_TOKEN_PROVIDER_EXCEPTION',
        expect.objectContaining({ error: 'Service unavailable' }),
        'testuser', '192.168.0.1', 'FAILURE', 'test-corr-id-token');
  });
});

// Re-add MockLogProvider for self-containment
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}
