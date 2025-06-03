// src/auth/AuthenticationChain.test.ts

// Mock AuthenticationProvider for testing purposes
interface MockAuthRequest {
  userId: string;
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
// Actual implementation might be in 'AuthenticationChain.ts'
class AuthenticationChain {
  private providers: MockAuthenticationProvider[] = [];

  addProvider(provider: MockAuthenticationProvider): void {
    this.providers.push(provider);
  }

  async execute(request: MockAuthRequest): Promise<MockAuthResponse> {
    let lastResponse: MockAuthResponse = { isAuthenticated: false, error: 'No providers in chain' };

    for (const provider of this.providers) {
      try {
        const response = await provider.authenticate(request);
        lastResponse = response; // Store the response from the current provider

        if (response.isAuthenticated) {
          // If a provider authenticates successfully, break the chain
          return response;
        }
        // If not authenticated, but no error, continue to the next provider
        // If there was an error, it might be handled by the provider itself or logged
        // For this simple chain, we just continue if not authenticated.
      } catch (error: any) {
        console.error(`Error in provider ${provider.getName()}: ${error.message}`);
        // Decide if an error from one provider should halt the chain
        // For this example, we'll return an error response immediately.
        return {
          isAuthenticated: false,
          error: `Provider ${provider.getName()} failed: ${error.message}`,
        };
      }
    }
    // If no provider authenticated successfully, return the last response from the chain
    return lastResponse;
  }
}

// Mock Provider Implementations
class MockSuccessProvider implements MockAuthenticationProvider {
  getName(): string { return "SuccessProvider"; }
  async authenticate(request: MockAuthRequest): Promise<MockAuthResponse> {
    if (request.userId === "testUser") {
      return { isAuthenticated: true, userId: request.userId, details: { provider: this.getName() } };
    }
    return { isAuthenticated: false, error: "Invalid user for SuccessProvider" };
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
