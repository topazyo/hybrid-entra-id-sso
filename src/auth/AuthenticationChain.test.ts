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

describe('AuthenticationChain', () => {
  let authChain: AuthenticationChain;

  beforeEach(() => {
    authChain = new AuthenticationChain();
  });

  it('should create an instance', () => {
    expect(authChain).toBeDefined();
  });

  it('should return isAuthenticated: false if no providers are added', async () => {
    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(false);
    expect(response.error).toBe('No providers in chain');
  });

  it('should authenticate successfully if a provider succeeds', async () => {
    authChain.addProvider(new MockFailureProvider());
    authChain.addProvider(new MockSuccessProvider());
    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(true);
    expect(response.userId).toBe("testUser");
    expect(response.details?.provider).toBe("SuccessProvider");
  });

  it('should return the last failure response if all providers fail', async () => {
    authChain.addProvider(new MockFailureProvider());
    authChain.addProvider(new MockFailureProvider()); // Add another one
    const response = await authChain.execute({ userId: "unknownUser" });
    expect(response.isAuthenticated).toBe(false);
    expect(response.error).toBe("Failed by FailureProvider");
  });

  it('should stop and return success on the first successful provider', async () => {
    const successProvider = new MockSuccessProvider();
    const failureProvider = new MockFailureProvider();
    jest.spyOn(successProvider, 'authenticate');
    jest.spyOn(failureProvider, 'authenticate');

    authChain.addProvider(successProvider);
    authChain.addProvider(failureProvider); // This should not be called if successProvider works

    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(true);
    expect(response.userId).toBe("testUser");
    expect(successProvider.authenticate).toHaveBeenCalledTimes(1);
    expect(failureProvider.authenticate).not.toHaveBeenCalled();
  });

  it('should handle providers that throw errors', async () => {
    authChain.addProvider(new MockErrorProvider());
    authChain.addProvider(new MockSuccessProvider()); // This should not be reached

    const response = await authChain.execute({ userId: "testUser" });
    expect(response.isAuthenticated).toBe(false);
    expect(response.error).toContain("ErrorProvider failed: Critical error in ErrorProvider");
  });

  it('should pass request object to each provider', async () => {
    const provider1 = new MockFailureProvider();
    const provider2 = new MockSuccessProvider();
    jest.spyOn(provider1, 'authenticate');
    jest.spyOn(provider2, 'authenticate');

    authChain.addProvider(provider1);
    authChain.addProvider(provider2);

    const request: MockAuthRequest = { userId: "testUser", source: "web" };
    await authChain.execute(request);

    expect(provider1.authenticate).toHaveBeenCalledWith(request);
    expect(provider2.authenticate).toHaveBeenCalledWith(request);
  });

  // Placeholder for more complex scenarios
  it.todo('should handle context pass-through between providers');
  it.todo('should allow a provider to modify request for subsequent providers');
});
