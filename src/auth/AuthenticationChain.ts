// src/auth/AuthenticationChain.ts
import { AuditLogger } from '../services/AuditLogger'; // Adjusted path

export interface AuthRequest {
  userId: string;
  correlationId?: string;
  [key: string]: any;
}

export interface AuthResponse {
  isAuthenticated: boolean;
  userId?: string;
  error?: string;
  details?: any;
}

export interface AuthenticationProvider {
  authenticate(request: AuthRequest): Promise<AuthResponse>;
  getName(): string;
}

export class AuthenticationChain {
  private providers: AuthenticationProvider[] = [];
  private auditLogger: AuditLogger;

  constructor(auditLogger: AuditLogger) {
    this.auditLogger = auditLogger;
  }

  addProvider(provider: AuthenticationProvider): void {
    this.providers.push(provider);
  }

  async execute(request: AuthRequest): Promise<AuthResponse> {
    const correlationId = request.correlationId || `chain-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
    this.auditLogger.logEvent(
      'AUTH_CHAIN_START',
      { userId: request.userId, providersInChain: this.providers.map(p => p.getName()) },
      request.userId,
      undefined, // clientIp
      'PENDING',
      correlationId
    );

    if (this.providers.length === 0) {
      const noProviderResponse: AuthResponse = { isAuthenticated: false, error: 'No providers in chain' };
      this.auditLogger.logEvent(
        'AUTH_CHAIN_COMPLETE',
        { result: noProviderResponse, reason: "No providers" },
        request.userId,
        undefined, // clientIp
        'FAILURE',
        correlationId
      );
      return noProviderResponse;
    }

    let lastResponse: AuthResponse = { isAuthenticated: false, error: 'Chain executed, but no provider succeeded definitively.' };

    for (const provider of this.providers) {
      this.auditLogger.logEvent(
        'AUTH_PROVIDER_START',
        { provider: provider.getName() },
        request.userId,
        undefined, // clientIp
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
            undefined, // clientIp
            'SUCCESS',
            correlationId
          );
          this.auditLogger.logEvent(
            'AUTH_CHAIN_COMPLETE',
            { result: response, authenticatedBy: provider.getName() },
            response.userId,
            undefined, // clientIp
            'SUCCESS',
            correlationId
          );
          return response;
        } else {
          this.auditLogger.logEvent(
            'AUTH_PROVIDER_FAILURE',
            { provider: provider.getName(), error: response.error, responseDetails: response.details },
            request.userId,
            undefined, // clientIp
            'FAILURE',
            correlationId
          );
        }
      } catch (error: any) {
        this.auditLogger.logEvent(
          'AUTH_PROVIDER_ERROR',
          { provider: provider.getName(), errorMessage: error.message, stack: error.stack },
          request.userId,
          undefined, // clientIp
          'FAILURE',
          correlationId
        );
        const errorResponse: AuthResponse = {
          isAuthenticated: false,
          error: `Provider ${provider.getName()} failed with exception: ${error.message}`,
        };
        this.auditLogger.logEvent(
          'AUTH_CHAIN_COMPLETE',
          { result: errorResponse, reason: `Provider ${provider.getName()} threw error` },
          request.userId,
          undefined, // clientIp
          'FAILURE',
          correlationId
        );
        return errorResponse; // Stop chain on provider error
      }
    }

    this.auditLogger.logEvent(
      'AUTH_CHAIN_COMPLETE',
      { result: lastResponse, reason: "No provider authenticated successfully" },
      request.userId,
      undefined, // clientIp
      'FAILURE',
      correlationId
    );
    return lastResponse;
  }
}
