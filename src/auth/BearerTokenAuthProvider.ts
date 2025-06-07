// src/auth/BearerTokenAuthProvider.ts
import { AuthenticationProvider, AuthRequest, AuthResponse, AuthError } from './AuthenticationChain';
import { AccessTokenService, VerificationResult, TokenClaims } from '../services/AccessTokenService';
import { AuditLogger, LogProvider, ConsoleLogProvider } from '../services/AuditLogger';

export class BearerTokenAuthProvider implements AuthenticationProvider {
  private accessTokenService: AccessTokenService;
  private auditLogger: AuditLogger;
  private readonly providerName = "BearerTokenAuthProvider";

  constructor(accessTokenService: AccessTokenService, logProvider?: LogProvider) {
    this.accessTokenService = accessTokenService;
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('authProvider', this.providerName);
    this.auditLogger.logSystemActivity(`${this.providerName} initialized`);
  }

  getName(): string {
    return this.providerName;
  }

  async authenticate(request: AuthRequest): Promise<AuthResponse> {
    const { userId, credentials, correlationId, ipAddress } = request;
    // This provider only handles 'token' type credentials.
    // It might optimistically try even if userId is not initially set from the bridge,
    // as the token itself should contain the authoritative userId (subject).

    this.auditLogger.logEvent(
      'BEARER_TOKEN_PROVIDER_AUTH_ATTEMPT',
      {
        userIdAttempted: userId, // userId from request, might be different from token's sub
        hasToken: !!(credentials && credentials.token),
        credentialType: credentials?.type
      },
      userId, ipAddress, 'PENDING', correlationId
    );

    if (!credentials || !credentials.token || credentials.type !== 'token') {
      const errorMsg = 'Bearer token credentials not provided or type mismatch.';
      // This provider should not aggressively fail if type doesn't match,
      // as another provider in the chain might handle it.
      // It should only fail if it's clearly meant for it (type 'token') but token is missing.
      if (credentials && credentials.type === 'token' && !credentials.token) {
         this.auditLogger.logEvent(
            'BEARER_TOKEN_PROVIDER_AUTH_FAILURE',
            { userIdAttempted: userId, reason: "Token of type 'token' was expected but not found.", credentialTypeProvided: credentials?.type },
            userId, ipAddress, 'FAILURE', correlationId
        );
        return {
            isAuthenticated: false,
            error: { code: 'INVALID_REQUEST_TOKEN_MISSING', message: "Token of type 'token' was expected but not found.", provider: this.providerName }
        };
      }
      // If type is not 'token', or no credentials, this provider doesn't handle it.
      // Return a non-committal failure that allows chain to continue.
      // However, for a clearer flow, often a bridge would select a provider or the chain would try based on request content.
      // For this specific provider, if it's not a token type, it should "pass" (not authenticate, not error hard).
      // Let's assume if type is not 'token', it's not for this provider.
       if (credentials && credentials.type && credentials.type !== 'token') {
         return { isAuthenticated: false }; // Not an error, just not handled by this provider
       }
       if (!credentials || !credentials.token) { // No credentials or no token string
            return { isAuthenticated: false, error: { code: 'NO_TOKEN_CREDENTIALS', message: 'No token credentials provided for BearerTokenAuthProvider.', provider: this.providerName } };
       }
    }

    try {
      const verificationResult: VerificationResult = await this.accessTokenService.verifyToken(credentials.token);

      if (verificationResult.isValid && verificationResult.userId) {
        this.auditLogger.logEvent(
          'BEARER_TOKEN_PROVIDER_AUTH_SUCCESS',
          {
            userId: verificationResult.userId,
            claims: verificationResult.claims, // Log claims carefully
            tokenUserId: verificationResult.userId, // User ID from token
            requestUserId: userId // User ID from original request, if any
          },
          verificationResult.userId, ipAddress, 'SUCCESS', correlationId
        );
        return {
          isAuthenticated: true,
          userId: verificationResult.userId, // Authoritative userId from token
          details: {
            provider: this.providerName,
            claims: verificationResult.claims,
            tokenSubject: verificationResult.userId
          },
        };
      } else {
        this.auditLogger.logEvent(
          'BEARER_TOKEN_PROVIDER_AUTH_FAILURE',
          {
            userIdAttempted: userId, // User from original request
            tokenUserId: verificationResult.userId, // User from token, if verification got that far
            reason: `Token verification failed: ${verificationResult.error}`,
            verificationError: verificationResult.error
          },
          userId || verificationResult.userId, ipAddress, 'FAILURE', correlationId
        );
        return {
          isAuthenticated: false,
          error: {
            code: `TOKEN_VERIFICATION_FAILED_${(verificationResult.error || 'UNKNOWN').toUpperCase()}`,
            message: verificationResult.error || 'Token verification failed.',
            provider: this.providerName
          },
          details: { tokenUserId: verificationResult.userId }
        };
      }
    } catch (error: any) { // Should not happen if verifyToken handles its errors, but as a safeguard
      this.auditLogger.logEvent(
        'BEARER_TOKEN_PROVIDER_EXCEPTION',
        { userIdAttempted: userId, error: error.message, stack: error.stack },
        userId, ipAddress, 'FAILURE', correlationId
      );
      return {
        isAuthenticated: false,
        error: {
            code: 'PROVIDER_EXCEPTION',
            message: `Exception in ${this.providerName}: ${error.message}`,
            provider: this.providerName,
            originalMessage: error.message
        },
      };
    }
  }
}
