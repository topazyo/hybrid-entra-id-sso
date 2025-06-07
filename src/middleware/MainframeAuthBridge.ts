// src/middleware/MainframeAuthBridge.ts
import { Request, Response, NextFunction } from 'express';
import { AuditLogger } from '../services/AuditLogger';
import { AuthenticationChain, AuthRequest, AuthResponse } from '../auth/AuthenticationChain';

export class MainframeAuthBridge {
  private auditLogger: AuditLogger;
  private authChain: AuthenticationChain;

  constructor(auditLogger: AuditLogger, authChain: AuthenticationChain) {
    this.auditLogger = auditLogger;
    this.authChain = authChain;
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
        credentialType = 'password';
        try {
          const basicAuthDecoded = Buffer.from(authHeader.substring(6), 'base64').toString();
          const parts = basicAuthDecoded.split(':');
          userIdAttempt = parts[0];
          passwordAttempt = parts.slice(1).join(':');
          if (!userIdAttempt || passwordAttempt === undefined) { // Basic validation for decoded parts
              throw new Error("Invalid Basic Auth structure after decoding.");
          }
        } catch (e) {
            this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_INVALID_BASIC_HEADER', { error: (e as Error).message, authHeaderProvided: authHeader }, undefined, clientIp, 'FAILURE', correlationId);
            res.status(400).json({ error: 'Invalid Basic Authorization header format.' });
            return;
        }
      } else if (authHeader.startsWith('Bearer ')) {
        credentialType = 'token';
        tokenAttempt = authHeader.substring(7).trim(); // Get token and trim whitespace
        // For Bearer tokens, userId is typically derived from the token itself by the verifying provider.
        // So, userIdAttempt can be generic here or undefined.
        // The BearerTokenAuthProvider will set the authoritative userId after verification.
        userIdAttempt = 'token_holder'; // Generic placeholder, or could be undefined
        passwordAttempt = undefined; // Ensure password is not set for token type
        if (!tokenAttempt) {
          this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_INVALID_BEARER_TOKEN', { reason: "Empty token string after 'Bearer ' prefix." }, undefined, clientIp, 'FAILURE', correlationId);
          res.status(400).json({ error: 'Invalid Bearer token: token string is empty.' });
          return;
        }
      } else {
        this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_UNSUPPORTED_AUTH_HEADER', { headerScheme: authHeader.split(' ')[0] }, undefined, clientIp, 'FAILURE', correlationId);
        res.status(400).json({ error: 'Unsupported Authorization header scheme.' });
        return;
      }
      this.auditLogger.logSystemActivity('Attempting authentication via MainframeAuthBridge', { userIdAttemptedForLog: userIdAttempt || 'N/A', authType: credentialType }, 'info');
    } else {
      this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_NO_AUTH_HEADER', { path: req.path }, undefined, clientIp, 'FAILURE', correlationId);
      res.status(401).json({ error: 'Authorization header missing.' });
      return;
    }
    
    // If userIdAttempt is truly optional until token verification by a token provider,
    // this check might be too strict or needs adjustment.
    // For password type, userId from Basic Auth is generally expected.
    // For token type, if the token is opaque and doesn't inherently carry a pre-verifiable userId,
    // then userIdAttempt might legitimately be a placeholder or undefined here.
    // The current RacfPasswordProvider and BearerTokenAuthProvider both expect a userId string in AuthRequest.
    if (!userIdAttempt) {
        this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_USERID_MISSING', { authType: credentialType, reason: "userIdAttempt resolved to undefined before AuthRequest construction." }, undefined, clientIp, 'FAILURE', correlationId);
        res.status(400).json({ error: 'User identifier could not be determined for authentication before provider call.' });
        return;
    }

    const authRequest: AuthRequest = {
      userId: userIdAttempt, // userId for password, placeholder for token if not in request
      credentials: {
        type: credentialType,
        password: passwordAttempt, // Will be undefined for token type
        token: tokenAttempt,       // Will be undefined for password type
      },
      ipAddress: clientIp,
      userAgent: req.headers['user-agent'],
      correlationId: correlationId,
    };

    try {
      const authResponse: AuthResponse = await this.authChain.execute(authRequest);

      if (authResponse.isAuthenticated && authResponse.userId) {
        res.locals.authenticatedUser = {
            id: authResponse.userId,
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
          { userIdAttempt: authRequest.userId, error: authResponse.error, details: authResponse.details }, // Log the userId passed to authChain
          authRequest.userId, clientIp, 'FAILURE', correlationId
        );
        res.status(401).json({ error: 'Authentication failed.', details: authResponse.error });
      }
    } catch (error: any) {
      this.auditLogger.logEvent(
        'MAINFRAME_AUTH_BRIDGE_CHAIN_EXCEPTION',
        { error: error.message, stack: error.stack },
        authRequest.userId, clientIp, 'FAILURE', correlationId // Log the userId passed to authChain
      );
      res.status(500).json({ error: 'Internal server error during authentication chain processing.' });
    }
  };
}
