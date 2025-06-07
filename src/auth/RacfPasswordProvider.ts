// src/auth/RacfPasswordProvider.ts
import { AuthenticationProvider, AuthRequest, AuthResponse, AuthError } from './AuthenticationChain';
import { RacfIntegrationService, RacfUserCredentials, RacfVerificationResult } from '../services/RacfIntegrationService';
import { AuditLogger, LogProvider, ConsoleLogProvider } from '../services/AuditLogger';

export class RacfPasswordProvider implements AuthenticationProvider {
  private racfService: RacfIntegrationService;
  private auditLogger: AuditLogger;
  private readonly providerName = "RacfPasswordProvider";

  constructor(racfService: RacfIntegrationService, logProvider?: LogProvider) {
    this.racfService = racfService;
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('authProvider', this.providerName);
    this.auditLogger.logSystemActivity(`${this.providerName} initialized`);
  }

  getName(): string {
    return this.providerName;
  }

  async authenticate(request: AuthRequest): Promise<AuthResponse> {
    const { userId, credentials, correlationId } = request;

    this.auditLogger.logEvent(
      'RACF_PASSWORD_PROVIDER_AUTH_ATTEMPT',
      { userId, hasPassword: !!(credentials && credentials.password) },
      userId,
      request.ipAddress, // Assuming ipAddress is passed in AuthRequest context
      'PENDING',
      correlationId
    );

    if (!credentials || !credentials.password || credentials.type !== 'password') {
      const errorMsg = 'Password credentials not provided or type mismatch.';
      this.auditLogger.logEvent(
        'RACF_PASSWORD_PROVIDER_AUTH_FAILURE',
        { userId, reason: errorMsg, credentialTypeProvided: credentials?.type },
        userId, request.ipAddress, 'FAILURE', correlationId
      );
      return {
        isAuthenticated: false,
        error: { code: 'INVALID_REQUEST', message: errorMsg, provider: this.providerName }
      };
    }

    try {
      const racfCredentials: RacfUserCredentials = {
        userId,
        password: credentials.password,
      };
      const racfResult: RacfVerificationResult = await this.racfService.verifyCredentials(racfCredentials);

      if (racfResult.isValid) {
        this.auditLogger.logEvent(
          'RACF_PASSWORD_PROVIDER_AUTH_SUCCESS',
          { userId, groups: racfResult.groups, details: racfResult.details },
          userId, request.ipAddress, 'SUCCESS', correlationId
        );
        return {
          isAuthenticated: true,
          userId: racfResult.userId, // Use userId from RACF result for canonical ID
          details: { provider: this.providerName, groups: racfResult.groups, ...racfResult.details },
        };
      } else {
        this.auditLogger.logEvent(
          'RACF_PASSWORD_PROVIDER_AUTH_FAILURE',
          { userId, reason: 'RACF verification failed', racfError: racfResult.error, details: racfResult.details },
          userId, request.ipAddress, 'FAILURE', correlationId
        );
        return {
          isAuthenticated: false,
          error: {
            code: 'AUTH_FAILED_RACF',
            message: racfResult.error || 'RACF authentication failed.',
            provider: this.providerName,
            originalMessage: racfResult.error
          },
          details: racfResult.details
        };
      }
    } catch (error: any) {
      this.auditLogger.logEvent(
        'RACF_PASSWORD_PROVIDER_EXCEPTION',
        { userId, error: error.message, stack: error.stack }, // Caution with stack in prod logs
        userId, request.ipAddress, 'FAILURE', correlationId
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
