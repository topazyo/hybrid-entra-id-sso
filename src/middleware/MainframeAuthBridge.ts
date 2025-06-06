// src/middleware/MainframeAuthBridge.ts
import { Request, Response, NextFunction } from 'express';
import { AuditLogger, LogProvider, ConsoleLogProvider } from '../services/AuditLogger';
import { AuthenticationChain, AuthRequest, AuthResponse } from '../auth/AuthenticationChain';
// import { RacfIntegrationService } from '../services/RacfIntegrationService'; // Future import

// Placeholder for RacfIntegrationService if needed by specific providers
// For now, AuthenticationChain itself doesn't directly depend on it.
// Providers within the chain might.

export class MainframeAuthBridge {
  private auditLogger: AuditLogger;
  private authChain: AuthenticationChain;
  // private racfService: RacfIntegrationService; // Future

  constructor(auditLogger: AuditLogger, authChain: AuthenticationChain /*, racfService?: RacfIntegrationService */) {
    this.auditLogger = auditLogger;
    this.authChain = authChain;
    // this.racfService = racfService || new RacfIntegrationService(auditLogger.getInstanceLogProvider()); // Example
    this.auditLogger.setGlobalContext('middleware', 'MainframeAuthBridge');
    this.auditLogger.logSystemActivity('MainframeAuthBridge initialized');
  }

  // Middleware function
  public bridge = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = req.headers['x-correlation-id'] as string || `bridge-${Date.now()}`;
    const clientIp = req.ip;

    this.auditLogger.logEvent(
      'MAINFRAME_AUTH_BRIDGE_REQUEST_RECEIVED',
      { path: req.path, method: req.method, headers: req.headers /* Be careful with logging all headers */ },
      undefined, clientIp, 'PENDING', correlationId
    );

    // 1. Extract Credentials/Token (Conceptual)
    // Example: Basic Auth, Bearer Token, or custom session cookie
    const authHeader = req.headers.authorization;
    let userIdAttempt: string | undefined = undefined;
    let tokenType: string | undefined = undefined;

    if (authHeader) {
      if (authHeader.startsWith('Basic ')) {
        tokenType = 'Basic';
        try {
          const basicAuthDecoded = Buffer.from(authHeader.substring(6), 'base64').toString();
          userIdAttempt = basicAuthDecoded.split(':')[0];
        } catch (e) {
            this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_INVALID_BASIC_HEADER', { error: (e as Error).message }, undefined, clientIp, 'FAILURE', correlationId);
            res.status(400).json({ error: 'Invalid Basic Authorization header format.' });
            return;
        }
      } else if (authHeader.startsWith('Bearer ')) {
        tokenType = 'Bearer';
        userIdAttempt = 'user_from_bearer_token'; // Placeholder: actual token parsing needed
      } else {
        this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_UNSUPPORTED_AUTH_HEADER', { headerScheme: authHeader.split(' ')[0] }, undefined, clientIp, 'FAILURE', correlationId);
        res.status(400).json({ error: 'Unsupported Authorization header scheme.' });
        return;
      }
      this.auditLogger.logSystemActivity('Attempting authentication via MainframeAuthBridge', { userIdAttempt, tokenType }, 'info');
    } else {
      // No Authorization header - could be an anonymous request or handled by a later middleware/route
      // For a bridge, usually auth header is expected.
      this.auditLogger.logEvent('MAINFRAME_AUTH_BRIDGE_NO_AUTH_HEADER', { path: req.path }, undefined, clientIp, 'FAILURE', correlationId);
      res.status(401).json({ error: 'Authorization header missing.' });
      return;
    }

    // 2. Prepare AuthRequest for AuthenticationChain
    const authRequest: AuthRequest = {
      userId: userIdAttempt || 'unknown_user_attempt', // Ensure userId is a string
      // Pass other relevant request details:
      ipAddress: clientIp,
      userAgent: req.headers['user-agent'],
      token: authHeader, // Pass the raw token for providers to inspect if needed
      tokenType: tokenType,
      correlationId: correlationId,
      // ... other context from request that might be useful for auth providers
    };

    // 3. Execute AuthenticationChain
    try {
      const authResponse: AuthResponse = await this.authChain.execute(authRequest);

      if (authResponse.isAuthenticated && authResponse.userId) {
        // 4. Attach User Information (Conceptual)
        // (req as any).user = { id: authResponse.userId, details: authResponse.details }; // If using Express.User
        res.locals.authenticatedUser = { id: authResponse.userId, details: authResponse.details }; // Safer alternative

        this.auditLogger.logEvent(
          'MAINFRAME_AUTH_BRIDGE_SUCCESS',
          { userId: authResponse.userId, details: authResponse.details },
          authResponse.userId, clientIp, 'SUCCESS', correlationId
        );
        next(); // Proceed to next middleware or route handler
      } else {
        this.auditLogger.logEvent(
          'MAINFRAME_AUTH_BRIDGE_FAILURE',
          { userIdAttempt, error: authResponse.error, details: authResponse.details },
          userIdAttempt, clientIp, 'FAILURE', correlationId
        );
        // Use 401 for authentication failures
        res.status(401).json({ error: 'Authentication failed.', details: authResponse.error });
      }
    } catch (error: any) {
      this.auditLogger.logEvent(
        'MAINFRAME_AUTH_BRIDGE_EXCEPTION',
        { error: error.message, stack: error.stack }, // Be cautious with logging full stack in prod logs
        userIdAttempt, clientIp, 'FAILURE', correlationId
      );
      res.status(500).json({ error: 'Internal server error during authentication.' });
    }
  };
}
