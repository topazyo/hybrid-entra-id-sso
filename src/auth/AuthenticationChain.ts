// src/auth/AuthenticationChain.ts
import { AuditLogger } from '../services/AuditLogger';

export interface AuthError { // New interface for structured errors
  code: string;
  message: string;
  provider?: string;
  originalMessage?: string; // To store original error message if we simplify the main one
}

export interface AuthRequest {
  userId: string;
  correlationId?: string;
  [key: string]: any;
}

export interface AuthResponse {
  isAuthenticated: boolean;
  userId?: string;
  error?: AuthError | string; // Can be a string for simple errors or AuthError for structured ones
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
      request.userId, undefined, 'PENDING', correlationId
    );

    if (this.providers.length === 0) {
      const noProviderResponse: AuthResponse = { isAuthenticated: false, error: 'No providers in chain' };
      this.auditLogger.logEvent(
        'AUTH_CHAIN_COMPLETE',
        { result: noProviderResponse, reason: "No providers" },
        request.userId, undefined, 'FAILURE', correlationId
      );
      return noProviderResponse;
    }

    let lastResponse: AuthResponse = { isAuthenticated: false, error: 'Chain executed, but no provider succeeded definitively.' };

    for (const provider of this.providers) {
      this.auditLogger.logEvent(
        'AUTH_PROVIDER_START',
        { provider: provider.getName() },
        request.userId, undefined, 'PENDING', correlationId
      );
      try {
        const response = await provider.authenticate(request);
        lastResponse = response;

        if (response.isAuthenticated) {
          this.auditLogger.logEvent(
            'AUTH_PROVIDER_SUCCESS',
            { provider: provider.getName(), responseDetails: response.details },
            response.userId, undefined, 'SUCCESS', correlationId
          );
          this.auditLogger.logEvent(
            'AUTH_CHAIN_COMPLETE',
            { result: response, authenticatedBy: provider.getName() },
            response.userId, undefined, 'SUCCESS', correlationId
          );
          return response;
        } else {
          // Provider explicitly failed (returned isAuthenticated: false)
          this.auditLogger.logEvent(
            'AUTH_PROVIDER_FAILURE',
            {
              provider: provider.getName(),
              error: response.error, // This could be string or AuthError from provider
              responseDetails: response.details
            },
            request.userId, undefined, 'FAILURE', correlationId
          );
        }
      } catch (error: any) {
        // Provider threw an exception
        const structuredError: AuthError = {
            code: 'PROVIDER_EXCEPTION',
            message: `Provider ${provider.getName()} threw an unhandled exception.`,
            provider: provider.getName(),
            originalMessage: error.message
        };
        this.auditLogger.logEvent(
          'AUTH_PROVIDER_ERROR',
          {
            providerName: provider.getName(),
            errorCode: structuredError.code,
            errorMessage: error.message, // Keep original message here for detailed logging
            // stack: error.stack // Optionally include stack, can be verbose
          },
          request.userId, undefined, 'FAILURE', correlationId
        );

        const errorResponse: AuthResponse = {
          isAuthenticated: false,
          error: structuredError, // Return the structured error
        };
        this.auditLogger.logEvent(
          'AUTH_CHAIN_COMPLETE',
          { result: errorResponse, reason: `Provider ${provider.getName()} threw error` },
          request.userId, undefined, 'FAILURE', correlationId
        );
        return errorResponse;
      }
    }

    this.auditLogger.logEvent(
      'AUTH_CHAIN_COMPLETE',
      { result: lastResponse, reason: "No provider authenticated successfully" },
      request.userId, undefined, 'FAILURE', correlationId
    );
    return lastResponse;
  }
}
