// src/auth/AuthenticationChain.test.ts
// ... (imports and mock providers as before)
// Import AuthError if it's exported from AuthenticationChain.ts, or redefine for test checks
import { AuthenticationChain, AuthenticationProvider, AuthRequest, AuthResponse, AuthError } from './AuthenticationChain';
import { AuditLogger, LogProvider } from '../services/AuditLogger';


// Mock LogProvider for testing AuditLogger
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

// Mock Provider Implementations (remain in test file for now)
class MockSuccessProvider implements AuthenticationProvider {
  getName(): string { return "SuccessProvider"; }
  async authenticate(request: AuthRequest): Promise<AuthResponse> {
    if (request.userId === "testUser") {
      return { isAuthenticated: true, userId: request.userId, details: { provider: this.getName() } };
    }
    return { isAuthenticated: false, error: "Invalid user for SuccessProvider", details: { provider: this.getName()} };
  }
}

class MockFailureProvider implements AuthenticationProvider {
  getName(): string { return "FailureProvider"; }
  async authenticate(request: AuthRequest): Promise<AuthResponse> {
    return { isAuthenticated: false, error: "Failed by FailureProvider", details: { provider: this.getName() } };
  }
}

class MockErrorProvider implements AuthenticationProvider {
  getName(): string { return "ErrorProvider"; }
  async authenticate(request: AuthRequest): Promise<AuthResponse> {
    throw new Error("Critical error in ErrorProvider");
  }
}

describe('AuthenticationChain with Real AuditLogger', () => {
  let authChain: AuthenticationChain;
  let realAuditLogger: AuditLogger;
  let mockLogProvider: MockLogProvider;
  let logEventSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    realAuditLogger = new AuditLogger(mockLogProvider); // Use real AuditLogger with MockLogProvider
    logEventSpy = jest.spyOn(realAuditLogger, 'logEvent'); // Spy on logEvent

    authChain = new AuthenticationChain(realAuditLogger); // Pass real (spied) AuditLogger
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    logEventSpy.mockRestore(); // Restore original method
    mockLogProvider.clearLogs();
    jest.useRealTimers();
  });

  it('should log chain start and completion when no providers are added', async () => {
    const request: AuthRequest = { userId: "testUser", correlationId: "corr-empty" };
    await authChain.execute(request);

    expect(logEventSpy).toHaveBeenCalledTimes(2);
    expect(logEventSpy).toHaveBeenNthCalledWith(1,
      'AUTH_CHAIN_START',
      expect.objectContaining({ userId: "testUser" }),
      "testUser",
      undefined,
      'PENDING',
      "corr-empty"
    );
    expect(logEventSpy).toHaveBeenNthCalledWith(2,
      'AUTH_CHAIN_COMPLETE',
      expect.objectContaining({ reason: "No providers" }),
      "testUser",
      undefined,
      'FAILURE',
      "corr-empty"
    );
  });

  it('should log provider success and chain completion', async () => {
    authChain.addProvider(new MockSuccessProvider());
    const request: AuthRequest = { userId: "testUser", correlationId: "corr-success" };
    await authChain.execute(request);

    expect(logEventSpy).toHaveBeenCalledTimes(4); // CHAIN_START, P1_START, P1_SUCCESS, CHAIN_COMPLETE
    expect(logEventSpy).toHaveBeenCalledWith(
      'AUTH_PROVIDER_SUCCESS',
      expect.objectContaining({ provider: "SuccessProvider" }),
      "testUser",
      undefined,
      'SUCCESS',
      "corr-success"
    );
    expect(logEventSpy).toHaveBeenCalledWith(
      'AUTH_CHAIN_COMPLETE',
      expect.objectContaining({ authenticatedBy: "SuccessProvider" }),
      "testUser",
      undefined,
      'SUCCESS',
      "corr-success"
    );
  });

  it('should log provider failure and continue, then chain failure if no other provider succeeds', async () => {
    authChain.addProvider(new MockFailureProvider());
    authChain.addProvider(new MockFailureProvider()); // Second failure
    const request: AuthRequest = { userId: "testUserUnknown", correlationId: "corr-all-fail" };
    await authChain.execute(request);

    // CHAIN_START, P1_START, P1_FAILURE, P2_START, P2_FAILURE, CHAIN_COMPLETE (overall failure)
    expect(logEventSpy).toHaveBeenCalledTimes(6);
    expect(logEventSpy).toHaveBeenCalledWith(
        'AUTH_PROVIDER_FAILURE',
        expect.objectContaining({ provider: "FailureProvider" }),
        "testUserUnknown",
        undefined,
        'FAILURE',
        "corr-all-fail"
    );
     expect(logEventSpy).toHaveBeenLastCalledWith(
      'AUTH_CHAIN_COMPLETE',
      expect.objectContaining({ reason: "No provider authenticated successfully" }),
      "testUserUnknown",
      undefined,
      'FAILURE',
      "corr-all-fail"
    );
  });

  // Modified test for provider errors:
  it('should log provider error with structured details and chain completion with failure', async () => {
    authChain.addProvider(new MockErrorProvider()); // This provider throws an error
    const request: AuthRequest = { userId: "testUser", correlationId: "corr-error-structured" };
    const response = await authChain.execute(request);

    // Verify the AuthResponse structure
    expect(response.isAuthenticated).toBe(false);
    expect(response.error).toBeDefined();
    const structuredError = response.error as AuthError; // Type assertion
    expect(structuredError.code).toBe('PROVIDER_EXCEPTION');
    expect(structuredError.provider).toBe('ErrorProvider');
    expect(structuredError.message).toBe('Provider ErrorProvider threw an unhandled exception.');
    expect(structuredError.originalMessage).toBe('Critical error in ErrorProvider');

    // Verify AuditLogger calls
    expect(logEventSpy).toHaveBeenCalledTimes(4); // CHAIN_START, P1_START, P1_ERROR, CHAIN_COMPLETE

    // Check the AUTH_PROVIDER_ERROR log
    const expectedProviderErrorDetails = {
      providerName: 'ErrorProvider',
      errorCode: 'PROVIDER_EXCEPTION',
      errorMessage: 'Critical error in ErrorProvider',
      // stack: expect.any(String) // If stack were included
    };
    expect(logEventSpy).toHaveBeenCalledWith(
      'AUTH_PROVIDER_ERROR',
      expect.objectContaining(expectedProviderErrorDetails),
      request.userId,
      undefined,
      'FAILURE',
      request.correlationId
    );

    // Check the AUTH_CHAIN_COMPLETE log
    expect(logEventSpy).toHaveBeenCalledWith(
      'AUTH_CHAIN_COMPLETE',
      expect.objectContaining({
        reason: "Provider ErrorProvider threw error",
        result: expect.objectContaining({
          isAuthenticated: false,
          error: structuredError // Verify the same structured error is in the logged result
        })
      }),
      request.userId,
      undefined,
      'FAILURE',
      request.correlationId
    );
  });

  // Original test for handling errors, ensure it's adapted or covered by the one above
  it('original: should handle providers that throw errors (now checks structured error)', async () => {
    authChain.addProvider(new MockErrorProvider());
    authChain.addProvider(new MockSuccessProvider());

    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(false);
    expect(response.error).toBeDefined();
    const errorDetails = response.error as AuthError;
    expect(errorDetails.code).toBe('PROVIDER_EXCEPTION');
    expect(errorDetails.provider).toBe('ErrorProvider');
    expect(errorDetails.originalMessage).toBe('Critical error in ErrorProvider');
  });

// ... (rest of the tests, e.g. original: should authenticate successfully if a provider succeeds)
  it('original: should authenticate successfully if a provider succeeds', async () => {
    authChain.addProvider(new MockFailureProvider());
    authChain.addProvider(new MockSuccessProvider());
    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(true);
    expect(response.userId).toBe("testUser");
  });
});
