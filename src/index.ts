// src/index.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import { AuditLogger, ConsoleLogProvider } from './services/AuditLogger';
import { HealthController } from './controllers/HealthController';
import { ConfigurationManager } from './services/ConfigurationManager';
import { RateLimiter } from './services/RateLimiter';
import { MainframeAuthBridge } from './middleware/MainframeAuthBridge';
import { RacfIntegrationService } from './services/RacfIntegrationService';
import { securityHeadersMiddleware } from './middleware/SecurityHeadersMiddleware';
import { param, validationResult } from 'express-validator'; // Removed matchedData as it's not used

// Import AuthenticationChain and Providers
import { AuthenticationChain } from './auth/AuthenticationChain';
import { RacfPasswordProvider } from './auth/RacfPasswordProvider';

// Initialize services
const auditLogger = new AuditLogger(new ConsoleLogProvider());
auditLogger.setGlobalContext('appName', 'HybridEntraIdSsoSuite');
auditLogger.setGlobalContext('appInstanceId', `instance-${Math.random().toString(36).substring(2, 10)}`);

const configManager = new ConfigurationManager(new ConsoleLogProvider());
configManager.loadFromEnv('APP_');
configManager.set('defaultPort', 3000);
configManager.set('healthCheck.testKey', 'healthyValue123');
configManager.set('appVersion', '0.1.0-running');

const healthController = new HealthController(new ConsoleLogProvider(), configManager, configManager.get('appVersion', '0.1.0-default'));
const rateLimiter = new RateLimiter(new ConsoleLogProvider());
const racfService = new RacfIntegrationService(new ConsoleLogProvider());

// Setup AuthenticationChain
const authChain = new AuthenticationChain(auditLogger); // Pass auditLogger to AuthChain
const racfPasswordProvider = new RacfPasswordProvider(racfService, new ConsoleLogProvider());
authChain.addProvider(racfPasswordProvider);
// Potentially add other providers to the chain here in the future

// Instantiate MainframeAuthBridge with AuditLogger and the configured AuthenticationChain
const mainframeAuthBridge = new MainframeAuthBridge(auditLogger, authChain);


const app: Express = express();
// app.set('trust proxy', 1);
const PORT: number = parseInt(configManager.get('port', configManager.get('defaultPort')) as string, 10);

// --- Global Middleware ---
app.use(express.json());
app.use(securityHeadersMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] || `http-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
  req.headers['x-correlation-id'] = correlationId as string;

  auditLogger.logSystemActivity(
    'Incoming HTTP Request',
    {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      correlationId: correlationId,
      headers: req.headers,
    },
    'info'
  );

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    auditLogger.logSystemActivity(
      'HTTP Request Finished',
      {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: durationMs,
        correlationId: correlationId,
      },
      res.statusCode >= 400 ? 'warn' : 'info'
    );
  });
  next();
});

const createRateLimitMiddleware = (
    limitConfig: { maxRequests: number, windowSeconds: number },
    endpointName: string
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.ip;

    if (!identifier) {
        auditLogger.logSystemActivity('RateLimitMiddleware: Could not determine identifier (req.ip is undefined)', { url: req.originalUrl }, 'warn');
        return next();
    }

    if (!rateLimiter.isAllowed(identifier, limitConfig.maxRequests, limitConfig.windowSeconds)) {
      auditLogger.logEvent(
        'RATE_LIMIT_APPLIED_MIDDLEWARE',
        {
          identifier,
          endpoint: endpointName,
          maxRequests: limitConfig.maxRequests,
          windowSeconds: limitConfig.windowSeconds,
          url: req.originalUrl
        },
        undefined,
        identifier,
        'FAILURE',
        req.headers['x-correlation-id'] as string | undefined
      );
      res.status(429).json({ error: 'Too Many Requests. Please try again later.' });
      return;
    }
    next();
  };
};

const healthRateLimitConfig = { maxRequests: 20, windowSeconds: 60 };
const configRateLimitConfig = { maxRequests: 10, windowSeconds: 60 };
const mainframeRouteRateLimitConfig = { maxRequests: 15, windowSeconds: 60 };

// Routes
app.get('/', (req: Request, res: Response) => {
  res.send('Hybrid Entra ID SSO Integration Suite is running!');
});

app.get(
  '/health',
  createRateLimitMiddleware(healthRateLimitConfig, '/health'),
  async (req: Request, res: Response) => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    const healthStatus = await healthController.getHealth(correlationId);
    if (healthStatus.status !== 'UP') {
      res.status(503).json(healthStatus);
      return;
    }
    res.status(200).json(healthStatus);
  } catch (error: any) {
    auditLogger.logSystemActivity('Error in /health endpoint', { error: error.message, stack: error.stack, correlationId: req.headers['x-correlation-id'] as string | undefined }, 'error');
    res.status(500).json({ status: 'ERROR', message: 'Internal server error during health check' });
  }
});

const SENSITIVE_KEY_PATTERNS = [/secret/i, /password/i, /key/i, /token/i];
const ALLOWED_CONFIG_KEYS = ['healthCheck.testKey', 'defaultPort', 'appVersion', 'appName'];

app.get(
  '/config/:key',
  createRateLimitMiddleware(configRateLimitConfig, '/config/:key'),
  param('key')
    .isString().withMessage('Key parameter must be a string.')
    .notEmpty().withMessage('Key parameter must not be empty.')
    .isLength({ min: 1, max: 255 }).withMessage('Key parameter must be between 1 and 255 characters.')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Key parameter contains invalid characters. Allowed: a-z, A-Z, 0-9, _, ., -'),
  (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      auditLogger.logEvent(
        'CONFIG_ACCESS_VALIDATION_ERROR',
        {
          key_provided: req.params.key,
          reason: 'express-validator validation failed',
          errors: errors.array()
        },
        undefined,
        req.ip,
        'FAILURE',
        req.headers['x-correlation-id'] as string | undefined
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const { key } = req.params;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    const clientIp = req.ip;

    const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key)) && !ALLOWED_CONFIG_KEYS.includes(key);
    if (isSensitive) {
      auditLogger.logEvent('CONFIG_ACCESS_DENIED', { key, reason: 'Sensitive key access restricted' }, undefined, clientIp, 'FAILURE', correlationId);
      return res.status(403).json({ error: 'Access to this configuration key is restricted.' });
    }

    const value = configManager.get(key);
    if (value !== undefined) {
      auditLogger.logEvent('CONFIG_ACCESS_SUCCESS', { key }, undefined, clientIp, 'SUCCESS', correlationId);
      return res.status(200).json({ key, value });
    } else {
      auditLogger.logEvent('CONFIG_ACCESS_NOT_FOUND', { key }, undefined, clientIp, 'INFO', correlationId);
      return res.status(404).json({ error: `Configuration key '${key}' not found.` });
    }
  }
);

app.get(
  '/api/v1/mainframe/data',
  createRateLimitMiddleware(mainframeRouteRateLimitConfig, '/api/v1/mainframe/data'),
  mainframeAuthBridge.bridge,
  (req: Request, res: Response) => {
    const authenticatedUser = res.locals.authenticatedUser as any;
    auditLogger.logEvent(
        'MAINFRAME_DATA_ACCESS_SUCCESS',
        { userId: authenticatedUser?.id, path: req.path },
        authenticatedUser?.id,
        req.ip,
        'SUCCESS',
        req.headers['x-correlation-id'] as string | undefined
    );
    res.status(200).json({
      message: 'Successfully accessed protected mainframe data.',
      user: authenticatedUser,
      data: {
        records: ["record1_data", "record2_data"],
        retrievedAt: new Date().toISOString()
      }
    });
  }
);


// Start server
app.listen(PORT, () => {
  auditLogger.logSystemActivity(`Server is running on port ${PORT}`, { port: PORT, environment: process.env.NODE_ENV || 'development' }, 'info');
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`Config access (example): http://localhost:${PORT}/config/appName`);
  console.log(`Mainframe data route (example): http://localhost:${PORT}/api/v1/mainframe/data`);
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    auditLogger.logSystemActivity('Unhandled Express Error', {
        errorMessage: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        correlationId: req.headers['x-correlation-id'] as string | undefined
    }, 'error');
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).send('Something broke!');
});

export default app;
