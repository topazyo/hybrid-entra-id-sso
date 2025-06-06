// src/middleware/MainframeAuthBridge.ts
import { Request, Response, NextFunction } from 'express';
import { AuditLogger } from '../services/AuditLogger';
import { AuthenticationChain, AuthRequest, AuthResponse } from '../auth/AuthenticationChain';
// RacfIntegrationService import is no longer needed directly by the bridge itself

export class MainframeAuthBridge {
  private auditLogger: AuditLogger;
  private authChain: AuthenticationChain; // Reverted to AuthenticationChain

  constructor(auditLogger: AuditLogger, authChain: AuthenticationChain) { // Changed constructor
    this.auditLogger = auditLogger;
    this.authChain = authChain; // Store AuthenticationChain
    this.auditLogger.setGlobalContext('middleware', 'MainframeAuthBridge');
    this.auditLogger.logSystemActivity('MainframeAuthBridge initialized with AuthenticationChain');
  }

  public bridge = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = req.headers['x-correlation-id'] as string || `bridge-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
    const clientIp = req.ip;

    this.auditLogger.logEvent(
      'MAINFRAME_AUTH_BRIDGE_REQUEST_RECEIVED',
      { path: req.path, method: req.method /* headers: req.headers - removed for brevity, still a caution */ },
      undefined, clientIp, 'PENDING', correlationId
    );

    const authHeader = req.headers.authorization;
    let userIdAttempt: string | undefined = undefined;
    let passwordAttempt: string | undefined = undefined;
    let tokenAttempt: string | undefined = undefined;
    let credentialType: 'password' | 'token' | string | undefined = undefined;

    if (authHeader) {
      if (authHeader.startsWith('Basic ')) {
        credentialType = 'password'; // Assuming Basic Auth implies password for RACF context
        try {
          const basicAuthDecoded = Buffer.from(authHeader.substring(6), 'base64').toString();
          const parts = basicAuthDecoded.split(':');
          userIdAttempt = parts[0];
          passwordAttempt = parts.slice(1).join(':');
        } catch (e) {
            this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_INVALID_BASIC_HEADER', { error: (e as Error).message }, undefined, clientIp, 'FAILURE', correlationId);
            res.status(400).json({ error: 'Invalid Basic Authorization header format.' });
            return;
        }
      } else if (authHeader.startsWith('Bearer ')) {
        credentialType = 'token';
        tokenAttempt = authHeader.substring(7);
        // userIdAttempt might be derived from token by a provider, or passed in another header/claim
        // For now, let's assume if it's a Bearer token, the userId might be part of the token itself
        // or the provider figures it out. We'll pass what we have.
        // For providers like RacfPasswordProvider, userId is mandatory in AuthRequest.
        // For a token provider, it might parse the token to get the userId.
        // Let's assume a placeholder or that specific providers handle userId extraction from token.
        userIdAttempt = 'user_from_token'; // Placeholder, specific provider should handle if needed
      } else {
        this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_UNSUPPORTED_AUTH_HEADER', { headerScheme: authHeader.split(' ')[0] }, undefined, clientIp, 'FAILURE', correlationId);
        res.status(400).json({ error: 'Unsupported Authorization header scheme.' });
        return;
      }
      this.auditLogger.logSystemActivity('Attempting authentication via MainframeAuthBridge', { userIdAttempt: userIdAttempt || 'N/A', authType: credentialType }, 'info');
    } else {
      this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_NO_AUTH_HEADER', { path: req.path }, undefined, clientIp, 'FAILURE', correlationId);
      res.status(401).json({ error: 'Authorization header missing.' });
      return;
    }
    
    // Ensure userIdAttempt is a string for AuthRequest, even if it's a placeholder
    if (!userIdAttempt) {
        // This case should ideally be caught earlier if authHeader is present but userId couldn't be derived.
        // For Basic, userIdAttempt is always derived. For Bearer, it's 'user_from_token'.
        // Adding a fallback, though it implies a logic flaw above if reached with an authHeader.
        userIdAttempt = "unknown_user_auth_attempt";
    }

    // Construct AuthRequest with the new credentials field
    const authRequest: AuthRequest = {
      userId: userIdAttempt,
      credentials: {
        type: credentialType,
        password: passwordAttempt,
        token: tokenAttempt,
      },
      ipAddress: clientIp,
      userAgent: req.headers['user-agent'],
      correlationId: correlationId,
      // other context...
    };

    try {
      // Use AuthenticationChain now
      const authResponse: AuthResponse = await this.authChain.execute(authRequest);

      if (authResponse.isAuthenticated && authResponse.userId) {
        res.locals.authenticatedUser = {
            id: authResponse.userId,
            // groups might be in authResponse.details.groups from RacfPasswordProvider
            groups: (authResponse.details as any)?.groups,
            authDetails: authResponse.details
        };
        this.auditLogger.logEvent(
          'MAINFRAME_AUTH_BRIDGE_SUCCESS',
          { userId: authResponse.userId, details: authResponse.details },
          authResponse.userId, clientIp, 'SUCCESS', correlationId
        );
        next();
      } else {
        this.auditLogger.logEvent(
          'MAINFRAME_AUTH_BRIDGE_FAILURE',
          { userIdAttempt, error: authResponse.error, details: authResponse.details },
          userIdAttempt, clientIp, 'FAILURE', correlationId
        );
        res.status(401).json({ error: 'Authentication failed.', details: authResponse.error });
      }
    } catch (error: any) { // This catch is for exceptions from authChain.execute() itself
      this.auditLogger.logEvent(
        'MAINFRAME_AUTH_BRIDGE_CHAIN_EXCEPTION', // Changed event name for clarity
        { error: error.message, stack: error.stack },
        userIdAttempt, clientIp, 'FAILURE', correlationId
      );
      res.status(500).json({ error: 'Internal server error during authentication chain processing.' });

    }
  };
}
