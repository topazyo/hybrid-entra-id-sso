// src/services/RacfIntegrationService.test.ts
import { RacfIntegrationService, RacfUserCredentials, RacfVerificationResult, RacfUserAttributes } from './RacfIntegrationService';
import { AuditLogger, LogProvider } from './AuditLogger';

// Mock LogProvider for testing AuditLogger within RacfIntegrationService
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

describe('RacfIntegrationService', () => {
  let racfService: RacfIntegrationService;
  let mockLogProvider: MockLogProvider;
  let logEventSpy: jest.SpyInstance;
  let logSystemActivitySpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    // Spy on AuditLogger.prototype methods before RacfIntegrationService instantiation
    logEventSpy = jest.spyOn(AuditLogger.prototype, 'logEvent');
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');

    racfService = new RacfIntegrationService(mockLogProvider);
  });

  afterEach(() => {
    logEventSpy.mockRestore();
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
  });

  it('should initialize and log initialization', () => {
    expect(racfService).toBeDefined();
    // logSystemActivitySpy is on the prototype, so new RacfIntegrationService() will call it.
    expect(logSystemActivitySpy).toHaveBeenCalledWith('RacfIntegrationService initialized');
  });

  describe('verifyCredentials', () => {
    it('should return isValid:true for correct testracfuser/password and log events', async () => {
      const creds: RacfUserCredentials = { userId: 'testracfuser', password: 'racfpassword' };
      const result = await racfService.verifyCredentials(creds);

      expect(result.isValid).toBe(true);
      expect(result.userId).toBe('testracfuser');
      expect(result.groups).toEqual(['RACFGRP1', 'USERS']);
      expect(logEventSpy).toHaveBeenCalledWith('RACF_VERIFY_CREDENTIALS_ATTEMPT',
        expect.objectContaining({ userId: 'testracfuser', hasPassword: true }),
        'testracfuser', undefined, 'PENDING', expect.any(String)
      );
      expect(logEventSpy).toHaveBeenCalledWith('RACF_VERIFY_CREDENTIALS_SUCCESS',
        expect.objectContaining(result),
        'testracfuser', undefined, 'SUCCESS', expect.any(String)
      );
    });

    it('should return isValid:true for correct tokenuser/token and log events', async () => {
      const creds: RacfUserCredentials = { userId: 'tokenuser', token: 'valid-racf-token' };
      const result = await racfService.verifyCredentials(creds);

      expect(result.isValid).toBe(true);
      expect(result.userId).toBe('tokenuser');
      expect(result.groups).toEqual(['TOKENGRP']);
      expect(logEventSpy).toHaveBeenCalledWith('RACF_VERIFY_CREDENTIALS_ATTEMPT',
        expect.objectContaining({ userId: 'tokenuser', hasToken: true }),
        'tokenuser', undefined, 'PENDING', expect.any(String)
      );
      expect(logEventSpy).toHaveBeenCalledWith('RACF_VERIFY_CREDENTIALS_SUCCESS',
        expect.objectContaining(result),
        'tokenuser', undefined, 'SUCCESS', expect.any(String)
      );
    });

    it('should return isValid:false for incorrect credentials and log events', async () => {
      const creds: RacfUserCredentials = { userId: 'testracfuser', password: 'wrongpassword' };
      const result = await racfService.verifyCredentials(creds);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid credentials');
      expect(logEventSpy).toHaveBeenCalledWith('RACF_VERIFY_CREDENTIALS_ATTEMPT',
        expect.objectContaining({ userId: 'testracfuser', hasPassword: true }),
        'testracfuser', undefined, 'PENDING', expect.any(String)
      );
      expect(logEventSpy).toHaveBeenCalledWith('RACF_VERIFY_CREDENTIALS_FAILURE',
        expect.objectContaining(result),
        'testracfuser', undefined, 'FAILURE', expect.any(String)
      );
    });

    it('should return isValid:false for an unknown user and log events', async () => {
      const creds: RacfUserCredentials = { userId: 'unknownuser', password: 'anypassword' };
      const result = await racfService.verifyCredentials(creds);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('user not found');
    });
  });

  describe('getUserAttributes', () => {
    it('should return attributes for a known user (testracfuser) and log events', async () => {
      const userId = 'testracfuser';
      const result = await racfService.getUserAttributes(userId);

      expect(result.error).toBeUndefined();
      expect(result.userId).toBe(userId);
      expect(result.attributes.department).toBe('IT_Mainframe_Ops');
      expect(result.attributes.customRacfField).toBe(`value_for_${userId}`);
      expect(logEventSpy).toHaveBeenCalledWith('RACF_GET_USER_ATTRIBUTES_ATTEMPT',
        { userId },
        userId, undefined, 'PENDING', expect.any(String)
      );
      expect(logEventSpy).toHaveBeenCalledWith('RACF_GET_USER_ATTRIBUTES_SUCCESS',
        expect.objectContaining({ userId, keysRetrieved: expect.any(Number) }),
        userId, undefined, 'SUCCESS', expect.any(String)
      );
    });

     it('should return attributes for another known user (tokenuser) and log events', async () => {
      const userId = 'tokenuser';
      const result = await racfService.getUserAttributes(userId);
      expect(result.error).toBeUndefined();
      expect(result.userId).toBe(userId);
      expect(result.attributes.location).toBe('BuildingA_Floor3');
    });

    it('should return an error for an unknown user and log events', async () => {
      const userId = 'unknownuser';
      const result = await racfService.getUserAttributes(userId);

      expect(result.error).toContain('User not found');
      expect(result.attributes).toEqual({});
      expect(logEventSpy).toHaveBeenCalledWith('RACF_GET_USER_ATTRIBUTES_ATTEMPT',
        { userId },
        userId, undefined, 'PENDING', expect.any(String)
      );
      expect(logEventSpy).toHaveBeenCalledWith('RACF_GET_USER_ATTRIBUTES_FAILURE',
        expect.objectContaining(result),
        userId, undefined, 'FAILURE', expect.any(String)
      );
    });
  });
});
