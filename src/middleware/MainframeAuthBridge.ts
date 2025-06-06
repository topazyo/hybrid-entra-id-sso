// src/middleware/MainframeAuthBridge.ts
import { Request, Response, NextFunction } from 'express';
import { AuditLogger } from '../services/AuditLogger'; // LogProvider, ConsoleLogProvider no longer directly needed
// AuthenticationChain import might be removed if no longer directly used by this simplified bridge
// import { AuthenticationChain, AuthRequest, AuthResponse } from '../auth/AuthenticationChain';
import { RacfIntegrationService, RacfUserCredentials, RacfVerificationResult } from '../services/RacfIntegrationService';

export class MainframeAuthBridge {
  private auditLogger: AuditLogger;
  private racfService: RacfIntegrationService;
  // private authChain: AuthenticationChain; // Potentially remove if direct RACF integration is the goal here

  constructor(auditLogger: AuditLogger, racfService: RacfIntegrationService /*, authChain?: AuthenticationChain*/) {
    this.auditLogger = auditLogger;
    this.racfService = racfService;
    // this.authChain = authChain; // If still needed for other scenarios
    this.auditLogger.setGlobalContext('middleware', 'MainframeAuthBridge');
    this.auditLogger.logSystemActivity('MainframeAuthBridge initialized with RacfIntegrationService');
  }

  public bridge = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = req.headers['x-correlation-id'] as string || `bridge-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
    const clientIp = req.ip;

    this.auditLogger.logEvent(
      'MAINFRAME_AUTH_BRIDGE_REQUEST_RECEIVED',
      { path: req.path, method: req.method, headers: req.headers },
      undefined, clientIp, 'PENDING', correlationId
    );

    const authHeader = req.headers.authorization;
    let userIdAttempt: string | undefined = undefined;
    let passwordAttempt: string | undefined = undefined;
    let tokenAttempt: string | undefined = undefined;
    let authType: string | undefined = undefined;

    if (authHeader) {
      if (authHeader.startsWith('Basic ')) {
        authType = 'Basic';
        try {
          const basicAuthDecoded = Buffer.from(authHeader.substring(6), 'base64').toString();
          const parts = basicAuthDecoded.split(':');
          userIdAttempt = parts[0];
          passwordAttempt = parts.slice(1).join(':'); // Handle passwords with colons
        } catch (e) {
            this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_INVALID_BASIC_HEADER', { error: (e as Error).message }, undefined, clientIp, 'FAILURE', correlationId);
            res.status(400).json({ error: 'Invalid Basic Authorization header format.' });
            return;
        }
      } else if (authHeader.startsWith('Bearer ')) {
        authType = 'Bearer';
        tokenAttempt = authHeader.substring(7);
        // For Bearer, userId might be part of the token or resolved by the verification service.
        // For this conceptual step, let's assume token itself is the primary credential for RACF service if type is token
        // Or, if userId is also expected with bearer, it would need to be extracted or passed differently.
        // Let's assume for now if it's bearer, userId is not pre-extracted here. RacfService might decode token.
        // For testability, let's make a placeholder if userId is needed by RacfService for token too.
        // For now, RacfService takes userId for token auth.
        // A common pattern is Bearer token is opaque, and validation service resolves the user.
        // Let's assume userId is still needed for our mock RacfService.
        // This part needs careful design based on actual token strategy.
        // For this step, let's assume if bearer, userId must be present in request somehow or resolved later.
        // For simplicity, we'll make the mock `RacfIntegrationService` handle it with a placeholder user for the token.
        // Or, we require a userId for bearer tokens too, e.g. from a claim or separate header.
        // Let's assume userIdAttempt is still relevant for logging.
        userIdAttempt = 'user_from_bearer_token_placeholder'; // This would be extracted from token in real scenario
      } else {
        this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_UNSUPPORTED_AUTH_HEADER', { headerScheme: authHeader.split(' ')[0] }, undefined, clientIp, 'FAILURE', correlationId);
        res.status(400).json({ error: 'Unsupported Authorization header scheme.' });
        return;
      }
      this.auditLogger.logSystemActivity('Attempting authentication via MainframeAuthBridge', { userIdAttempt, authType }, 'info');
    } else {
      this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_NO_AUTH_HEADER', { path: req.path }, undefined, clientIp, 'FAILURE', correlationId);
      res.status(401).json({ error: 'Authorization header missing.' });
      return;
    }
    
    if (!userIdAttempt && authType === 'Bearer') { // If bearer token needs a user context not in token itself
        // This logic depends on how bearer tokens are to be handled with RACF.
        // For now, assume our mock RacfService can take a known 'tokenuser' for specific tokens.
        if (tokenAttempt === 'valid-racf-token') userIdAttempt = 'tokenuser';
        else userIdAttempt = 'unknown_bearer_user';
    }
    if (!userIdAttempt) { // Still no userId after attempting to parse.
        this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_USERID_MISSING', { authType }, undefined, clientIp, 'FAILURE', correlationId);
        res.status(400).json({ error: 'User identifier could not be determined for authentication.' });
        return;
    }

    const racfCredentials: RacfUserCredentials = {
      userId: userIdAttempt,
      password: passwordAttempt,
      token: tokenAttempt,
    };

    try {
      const racfVerificationResult: RacfVerificationResult = await this.racfService.verifyCredentials(racfCredentials);

      if (racfVerificationResult.isValid && racfVerificationResult.userId) {
        res.locals.authenticatedUser = {
            id: racfVerificationResult.userId,
            groups: racfVerificationResult.groups,
            authDetails: racfVerificationResult.details
        };
        this.auditLogger.logEvent(
          'MAINFRAME_AUTH_BRIDGE_SUCCESS',
          { userId: racfVerificationResult.userId, groups: racfVerificationResult.groups, details: racfVerificationResult.details },
          racfVerificationResult.userId, clientIp, 'SUCCESS', correlationId
        );
        next();
      } else {
        this.auditLogger.logEvent(
          'MAINFRAME_AUTH_BRIDGE_FAILURE',
          { userIdAttempt, error: racfVerificationResult.error, details: racfVerificationResult.details },
          userIdAttempt, clientIp, 'FAILURE', correlationId
        );
        res.status(401).json({ error: 'Authentication failed.', details: racfVerificationResult.error });
      }
    } catch (error: any) {
      this.auditLogger.logEvent(
        'MAINFRAME_AUTH_BRIDGE_EXCEPTION',
        { error: error.message, stack: error.stack },
        userIdAttempt, clientIp, 'FAILURE', correlationId
      );
      res.status(500).json({ error: 'Internal server error during authentication.' });
    }
  };
}
