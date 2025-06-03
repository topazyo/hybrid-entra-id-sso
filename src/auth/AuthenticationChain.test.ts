// src/auth/AuthenticationChain.test.ts
import { AuthenticationChain, AuthenticationProvider, AuthRequest, AuthResponse } from './AuthenticationChain'; // Import from new location
import { AuditLogger, LogProvider, ConsoleLogProvider } from '../services/AuditLogger'; // Import real AuditLogger

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

  it('should log provider error and chain completion with failure', async () => {
    authChain.addProvider(new MockErrorProvider());
    const request: AuthRequest = { userId: "testUser", correlationId: "corr-error" };
    await authChain.execute(request);

    expect(logEventSpy).toHaveBeenCalledTimes(4); // CHAIN_START, P1_START, P1_ERROR, CHAIN_COMPLETE (failure)
    expect(logEventSpy).toHaveBeenCalledWith(
      'AUTH_PROVIDER_ERROR',
      expect.objectContaining({ provider: "ErrorProvider", errorMessage: "Critical error in ErrorProvider" }),
      "testUser",
      undefined,
      'FAILURE',
      "corr-error"
    );
    expect(logEventSpy).toHaveBeenCalledWith(
      'AUTH_CHAIN_COMPLETE',
      expect.objectContaining({ reason: "Provider ErrorProvider threw error" }),
      "testUser",
      undefined,
      'FAILURE',
      "corr-error"
    );
  });

  // Original functional tests should still pass
  it('original: should authenticate successfully if a provider succeeds', async () => {
    authChain.addProvider(new MockFailureProvider());
    authChain.addProvider(new MockSuccessProvider());
    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(true);
    expect(response.userId).toBe("testUser");
  });

  it('original: should handle providers that throw errors', async () => {
    authChain.addProvider(new MockErrorProvider());
    authChain.addProvider(new MockSuccessProvider());

    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(false);
    expect(response.error).toContain("Provider ErrorProvider failed with exception: Critical error in ErrorProvider");
  });

});
