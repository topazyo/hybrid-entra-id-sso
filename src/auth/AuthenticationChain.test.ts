// src/auth/AuthenticationChain.test.ts

// --- Re-defined AuditLogger related interfaces/classes for self-containment ---
// In a real setup, these would be imported from 'src/services/AuditLogger.ts'
interface MockAuditEvent {
  timestamp: Date;
  eventType: string;
  eventDetails: any;
  userId?: string;
  status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO';
  correlationId?: string;
}

interface MockLogProvider {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  clearLogs?(): void; // Optional for mock
}

class MockAuditLogger {
  public loggedEvents: { eventType: string, eventDetails: any, userId?: string, status?: string, correlationId?: string }[] = [];
  private logger: MockLogProvider; // Can be used internally if needed, or spy directly on logEvent

  constructor(logProvider?: MockLogProvider) {
    this.logger = logProvider || { info: ()=>{}, warn: ()=>{}, error: ()=>{} };
  }

  public logEvent(
    eventType: string,
    eventDetails: any,
    userId?: string,
    _clientIp?: string, // Not used in this simplified test mock for AuthenticationChain
    status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'INFO',
    correlationId?: string
  ): void {
    this.loggedEvents.push({ eventType, eventDetails, userId, status, correlationId });
  }

  public clearEvents(): void {
    this.loggedEvents = [];
  }
}
// --- End of re-defined AuditLogger related items ---


// Mock AuthenticationProvider for testing purposes
interface MockAuthRequest {
  userId: string;
  correlationId?: string; // Added for tracking
  [key: string]: any;
}

interface MockAuthResponse {
  isAuthenticated: boolean;
  userId?: string;
  error?: string;
  details?: any;
}

interface MockAuthenticationProvider {
  authenticate(request: MockAuthRequest): Promise<MockAuthResponse>;
  getName(): string;
}

// Simplified AuthenticationChain class for demonstration
class AuthenticationChain {
  private providers: MockAuthenticationProvider[] = [];
  private auditLogger: MockAuditLogger; // Using MockAuditLogger

  constructor(auditLogger: MockAuditLogger) { // Accept AuditLogger
    this.auditLogger = auditLogger;
  }

  addProvider(provider: MockAuthenticationProvider): void {
    this.providers.push(provider);
  }

  async execute(request: MockAuthRequest): Promise<MockAuthResponse> {
    const correlationId = request.correlationId || `chain-${Date.now()}`;
    this.auditLogger.logEvent(
      'AUTH_CHAIN_START',
      { userId: request.userId, providersInChain: this.providers.map(p => p.getName()) },
      request.userId,
      undefined,
      'PENDING',
      correlationId
    );

    if (this.providers.length === 0) {
      const noProviderResponse = { isAuthenticated: false, error: 'No providers in chain' };
      this.auditLogger.logEvent(
        'AUTH_CHAIN_COMPLETE',
        { result: noProviderResponse, reason: "No providers" },
        request.userId,
        undefined,
        'FAILURE',
        correlationId
      );
      return noProviderResponse;
    }

    let lastResponse: MockAuthResponse = { isAuthenticated: false, error: 'Chain executed, but no provider succeeded definitively.' };

    for (const provider of this.providers) {
      this.auditLogger.logEvent(
        'AUTH_PROVIDER_START',
        { provider: provider.getName() },
        request.userId,
        undefined,
        'PENDING',
        correlationId
      );
      try {
        const response = await provider.authenticate(request);
        lastResponse = response;

        if (response.isAuthenticated) {
          this.auditLogger.logEvent(
            'AUTH_PROVIDER_SUCCESS',
            { provider: provider.getName(), responseDetails: response.details },
            response.userId,
            undefined,
            'SUCCESS',
            correlationId
          );
          this.auditLogger.logEvent(
            'AUTH_CHAIN_COMPLETE',
            { result: response, authenticatedBy: provider.getName() },
            response.userId,
            undefined,
            'SUCCESS',
            correlationId
          );
          return response;
        } else {
          this.auditLogger.logEvent(
            'AUTH_PROVIDER_FAILURE',
            { provider: provider.getName(), error: response.error, responseDetails: response.details },
            request.userId, // or response.userId if available and relevant on failure
            undefined,
            'FAILURE',
            correlationId
          );
        }
      } catch (error: any) {
        this.auditLogger.logEvent(
          'AUTH_PROVIDER_ERROR',
          { provider: provider.getName(), errorMessage: error.message, stack: error.stack },
          request.userId,
          undefined,
          'FAILURE',
          correlationId
        );
        const errorResponse = {
          isAuthenticated: false,
          error: `Provider ${provider.getName()} failed with exception: ${error.message}`,
        };
        this.auditLogger.logEvent(
          'AUTH_CHAIN_COMPLETE',
          { result: errorResponse, reason: `Provider ${provider.getName()} threw error` },
          request.userId,
          undefined,
          'FAILURE',
          correlationId
        );
        return errorResponse; // Stop chain on provider error
      }
    }

    // If loop completes without success or error thrown by provider
    this.auditLogger.logEvent(
      'AUTH_CHAIN_COMPLETE',
      { result: lastResponse, reason: "No provider authenticated successfully" },
      request.userId, // or lastResponse.userId if available
      undefined,
      'FAILURE',
      correlationId
    );
    return lastResponse;
  }
}

// Mock Provider Implementations (unchanged from previous version)
class MockSuccessProvider implements MockAuthenticationProvider {
  getName(): string { return "SuccessProvider"; }
  async authenticate(request: MockAuthRequest): Promise<MockAuthResponse> {
    if (request.userId === "testUser") {
      return { isAuthenticated: true, userId: request.userId, details: { provider: this.getName() } };
    }
    return { isAuthenticated: false, error: "Invalid user for SuccessProvider", details: { provider: this.getName()} };
  }
}

class MockFailureProvider implements MockAuthenticationProvider {
  getName(): string { return "FailureProvider"; }
  async authenticate(request: MockAuthRequest): Promise<MockAuthResponse> {
    return { isAuthenticated: false, error: "Failed by FailureProvider", details: { provider: this.getName() } };
  }
}

class MockErrorProvider implements MockAuthenticationProvider {
  getName(): string { return "ErrorProvider"; }
  async authenticate(request: MockAuthRequest): Promise<MockAuthResponse> {
    throw new Error("Critical error in ErrorProvider");
  }
}

describe('AuthenticationChain with AuditLogging', () => {
  let authChain: AuthenticationChain;
  let mockAuditLogger: MockAuditLogger; // Use the mock for AuditLogger

  beforeEach(() => {
    mockAuditLogger = new MockAuditLogger(); // Instantiate the mock
    authChain = new AuthenticationChain(mockAuditLogger); // Pass mock to constructor
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    mockAuditLogger.clearEvents(); // Clear events for next test
    jest.useRealTimers();
  });

  it('should log chain start and completion when no providers are added', async () => {
    const request = { userId: "testUser", correlationId: "corr-empty" };
    await authChain.execute(request);

    expect(mockAuditLogger.loggedEvents.length).toBe(2);
    expect(mockAuditLogger.loggedEvents[0]).toMatchObject({
      eventType: 'AUTH_CHAIN_START',
      userId: "testUser",
      status: 'PENDING',
      correlationId: "corr-empty"
    });
    expect(mockAuditLogger.loggedEvents[1]).toMatchObject({
      eventType: 'AUTH_CHAIN_COMPLETE',
      userId: "testUser",
      status: 'FAILURE',
      correlationId: "corr-empty",
      eventDetails: expect.objectContaining({ reason: "No providers" })
    });
  });

  it('should log provider success and chain completion', async () => {
    authChain.addProvider(new MockSuccessProvider());
    const request = { userId: "testUser", correlationId: "corr-success" };
    await authChain.execute(request);

    // Expected logs: CHAIN_START, PROVIDER_START, PROVIDER_SUCCESS, CHAIN_COMPLETE
    expect(mockAuditLogger.loggedEvents.length).toBe(4);
    expect(mockAuditLogger.loggedEvents.find(e => e.eventType === 'AUTH_PROVIDER_SUCCESS')).toMatchObject({
      userId: "testUser",
      status: 'SUCCESS',
      eventDetails: expect.objectContaining({ provider: "SuccessProvider" })
    });
    expect(mockAuditLogger.loggedEvents.find(e => e.eventType === 'AUTH_CHAIN_COMPLETE' && e.status === 'SUCCESS')).toBeTruthy();
  });

  it('should log provider failure and continue, then chain failure', async () => {
    authChain.addProvider(new MockFailureProvider());
    authChain.addProvider(new MockSuccessProvider()); // This one will succeed
    const request = { userId: "testUser", correlationId: "corr-fail-continue" };
    await authChain.execute(request);

    // CHAIN_START, P1_START, P1_FAILURE, P2_START, P2_SUCCESS, CHAIN_COMPLETE
    expect(mockAuditLogger.loggedEvents.length).toBe(6);
    const failureLog = mockAuditLogger.loggedEvents.find(e => e.eventType === 'AUTH_PROVIDER_FAILURE');
    expect(failureLog).toMatchObject({
      eventDetails: expect.objectContaining({ provider: "FailureProvider" }),
      status: 'FAILURE'
    });
    const successLog = mockAuditLogger.loggedEvents.find(e => e.eventType === 'AUTH_PROVIDER_SUCCESS');
    expect(successLog).toMatchObject({
      eventDetails: expect.objectContaining({ provider: "SuccessProvider" }),
      status: 'SUCCESS'
    });
    expect(mockAuditLogger.loggedEvents.find(e => e.eventType === 'AUTH_CHAIN_COMPLETE' && e.status === 'SUCCESS')).toBeTruthy();
  });

  it('should log provider error and chain completion with failure', async () => {
    authChain.addProvider(new MockErrorProvider());
    const request = { userId: "testUser", correlationId: "corr-error" };
    await authChain.execute(request);

    // CHAIN_START, P1_START, P1_ERROR, CHAIN_COMPLETE (failure)
    expect(mockAuditLogger.loggedEvents.length).toBe(4);
    const errorLog = mockAuditLogger.loggedEvents.find(e => e.eventType === 'AUTH_PROVIDER_ERROR');
    expect(errorLog).toMatchObject({
      eventDetails: expect.objectContaining({ provider: "ErrorProvider", errorMessage: "Critical error in ErrorProvider" }),
      status: 'FAILURE'
    });
     const chainCompleteLog = mockAuditLogger.loggedEvents.find(e => e.eventType === 'AUTH_CHAIN_COMPLETE' && e.status === 'FAILURE');
    expect(chainCompleteLog).toBeTruthy();
    expect(chainCompleteLog?.eventDetails).toMatchObject({
        reason: "Provider ErrorProvider threw error"
    });
  });

  // Keep existing tests and adapt them if necessary, or ensure they still pass
  it('original: should authenticate successfully if a provider succeeds', async () => {
    authChain.addProvider(new MockFailureProvider());
    authChain.addProvider(new MockSuccessProvider());
    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(true);
    expect(response.userId).toBe("testUser");
  });

  it('original: should handle providers that throw errors', async () => {
    authChain.addProvider(new MockErrorProvider());
    authChain.addProvider(new MockSuccessProvider()); // This should not be reached

    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(false);
    expect(response.error).toContain("ErrorProvider failed with exception: Critical error in ErrorProvider");
  });

});
