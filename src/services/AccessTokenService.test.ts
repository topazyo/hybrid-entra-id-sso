// src/services/AccessTokenService.test.ts
import { AccessTokenService, VerificationResult, TokenClaims } from './AccessTokenService';
import { AuditLogger, LogProvider } from './AuditLogger';

// Mock LogProvider
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

describe('AccessTokenService (Conceptual JWTs)', () => {
  let tokenService: AccessTokenService;
  let mockLogProvider: MockLogProvider;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;
  const testUserId = 'user123';

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');

    tokenService = new AccessTokenService(mockLogProvider, 60); // Short expiry for testing
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs(); // Clear logs from the mock provider itself
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should initialize and log initialization', () => {
    expect(tokenService).toBeDefined();
    expect(logSystemActivitySpy).toHaveBeenCalledWith('AccessTokenService initialized', { defaultTokenExpirationSeconds: 60 });
  });

  describe('generateToken', () => {
    it('should generate a mock token string with 3 parts', async () => {
      const token = await tokenService.generateToken(testUserId);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);
      expect(logEventSpy).toHaveBeenCalledWith('ACCESS_TOKEN_GENERATED',
        expect.objectContaining({ userId: testUserId }),
        testUserId, undefined, 'SUCCESS');
    });

    it('should include standard claims (sub, iss, aud, iat, exp, jti) in mock payload', async () => {
      const token = await tokenService.generateToken(testUserId, { custom: 'data' });
      const payloadBase64 = token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString()) as TokenClaims;

      expect(payload.sub).toBe(testUserId);
      expect(payload.iss).toBeDefined(); // Mock issuer
      expect(payload.aud).toBeDefined(); // Mock audience
      expect(payload.iat).toBe(Math.floor(new Date('2024-01-01T00:00:00.000Z').getTime() / 1000));
      expect(payload.exp).toBe(payload.iat! + 60); // 60s expiry from constructor
      expect(payload.jti).toBeDefined();
      expect(payload.custom).toBe('data');
    });
  });

  describe('verifyToken', () => {
    let validMockToken: string;
    beforeEach(async () => {
      // Clear log spy calls from generateToken before each verifyToken test
      logEventSpy.mockClear();
      validMockToken = await tokenService.generateToken(testUserId, { scope: 'read' });
      // Clear the generateToken log again after it's created for the test
      logEventSpy.mockClear();
    });

    it('should verify a valid mock token successfully', async () => {
      const result = await tokenService.verifyToken(validMockToken);
      expect(result.isValid).toBe(true);
      expect(result.userId).toBe(testUserId);
      expect(result.claims?.sub).toBe(testUserId);
      expect(result.claims?.scope).toBe('read');
      expect(result.error).toBeUndefined();
      expect(logEventSpy).toHaveBeenCalledWith('ACCESS_TOKEN_VERIFICATION_ATTEMPT', expect.anything(), undefined, undefined, 'PENDING');
      expect(logEventSpy).toHaveBeenCalledWith('ACCESS_TOKEN_VERIFICATION_SUCCESS',
        expect.objectContaining({ userId: testUserId }),
        testUserId, undefined, 'SUCCESS');
    });

    it('should return invalid for a malformed token (not 3 parts)', async () => {
      const result = await tokenService.verifyToken('invalid.token');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('malformed_token');
      expect(logEventSpy).toHaveBeenCalledWith('ACCESS_TOKEN_VERIFICATION_FAILURE',
        expect.objectContaining({ reason: 'Malformed token (not 3 parts)' }),
        undefined, undefined, 'FAILURE');
    });

    it('should return invalid for a token with invalid mock signature', async () => {
        const parts = validMockToken.split('.');
        const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignatureplaceholder`;
        const result = await tokenService.verifyToken(tamperedToken);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('invalid_mock_signature');
    });

    it('should return invalid if token is expired', async () => {
      jest.advanceTimersByTime(61 * 1000); // Advance time by 61 seconds (token expires in 60s)
      const result = await tokenService.verifyToken(validMockToken);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('token_expired');
      expect(result.userId).toBe(testUserId);
      expect(logEventSpy).toHaveBeenCalledWith('ACCESS_TOKEN_VERIFICATION_FAILURE',
        expect.objectContaining({ reason: 'Token expired', userId: testUserId }),
        testUserId, undefined, 'FAILURE');
    });

    it('should return invalid if issuer is incorrect', async () => {
        const claims = { sub: testUserId, iss: 'WrongIssuer', aud: 'HybridSsoSuiteMockAudience', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 60, jti: 'id' };
        const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        // Use the correct mock signature format for this test to focus on issuer
        const sig = Buffer.from(`signed_with_super_secret_key_for_mock_jwt`).toString('base64url');
        const customToken = `${header}.${payload}.${sig}`;

        const result = await tokenService.verifyToken(customToken);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('invalid_issuer');
    });

    it('should return invalid for malformed JSON in payload', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const malformedPayload = Buffer.from("this-is-not-json").toString('base64url');
      const sig = Buffer.from(`signed_with_super_secret_key_for_mock_jwt`).toString('base64url');
      const token = `${header}.${malformedPayload}.${sig}`;
      const result = await tokenService.verifyToken(token);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('malformed_payload_json');
    });
  });
});
