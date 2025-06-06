// src/index.ts
import express, { Express, Request, Response, NextFunction } from 'express'; // Ensure NextFunction is imported
import { AuditLogger, ConsoleLogProvider } from './services/AuditLogger'; // Assuming ConsoleLogProvider is exported
import { HealthController } from './controllers/HealthController';
import { ConfigurationManager } from './services/ConfigurationManager'; // For port configuration

// Initialize services
const auditLogger = new AuditLogger(new ConsoleLogProvider());
auditLogger.setGlobalContext('appName', 'HybridEntraIdSsoSuite');
auditLogger.setGlobalContext('appInstanceId', `instance-${Math.random().toString(36).substring(2, 10)}`);

const configManager = new ConfigurationManager(new ConsoleLogProvider()); // Provide logger
configManager.loadFromEnv('APP_'); // Example: APP_PORT=3000
configManager.set('defaultPort', 3000); // Set a default if not in env
// Example of setting a non-sensitive, allowed key for testing the /config endpoint
configManager.set('healthCheck.testKey', 'healthyValue123');
configManager.set('appVersion', '0.1.0-running'); // Set app version for /config endpoint

const healthController = new HealthController(new ConsoleLogProvider(), configManager, configManager.get('appVersion', '0.1.0-default')); // Pass LogProvider & ConfigManager


const app: Express = express();
const PORT: number = parseInt(configManager.get('port', configManager.get('defaultPort')) as string, 10);

// Middleware (optional for now, but good for future)
app.use(express.json());
// Basic request logging middleware using AuditLogger
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] || `http-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
  req.headers['x-correlation-id'] = correlationId as string; // Ensure it's available for downstream

  auditLogger.logSystemActivity(
    'Incoming HTTP Request',
    {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      correlationId: correlationId,
      headers: req.headers, // Be cautious logging all headers in prod
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
      res.statusCode >= 400 ? 'warn' : 'info' // Log errors/warnings for 4xx/5xx
    );
  });
  next();
});


// Routes
app.get('/', (req: Request, res: Response) => {
  res.send('Hybrid Entra ID SSO Integration Suite is running!');
});

app.get('/health', async (req: Request, res: Response) => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    const healthStatus = await healthController.getHealth(correlationId);
    if (healthStatus.status !== 'UP') {
      res.status(503).json(healthStatus); // Service Unavailable
      return;
    }
    res.status(200).json(healthStatus);
  } catch (error: any) {
    auditLogger.logSystemActivity('Error in /health endpoint', { error: error.message, stack: error.stack, correlationId: req.headers['x-correlation-id'] as string | undefined }, 'error');
    res.status(500).json({ status: 'ERROR', message: 'Internal server error during health check' });
  }
});

// --- Updated /config/:key route with input validation ---
const SENSITIVE_KEY_PATTERNS = [/secret/i, /password/i, /key/i, /token/i];
const ALLOWED_CONFIG_KEYS = ['healthCheck.testKey', 'defaultPort', 'appVersion', 'appName'];
const VALID_CONFIG_KEY_REGEX = /^[a-zA-Z0-9_.-]{1,255}$/; // Added min/max length, adjust as needed

app.get('/config/:key', (req: Request, res: Response) => {
  const { key } = req.params;
  const correlationId = req.headers['x-correlation-id'] as string | undefined;

  // 1. Input Validation
  if (!VALID_CONFIG_KEY_REGEX.test(key)) {
    auditLogger.logEvent(
      'CONFIG_ACCESS_VALIDATION_ERROR',
      { key, reason: 'Invalid key format', regex: VALID_CONFIG_KEY_REGEX.source },
      undefined, // userId
      req.ip,    // clientIp
      'FAILURE',
      correlationId
    );
    res.status(400).json({ error: `Invalid key format. Key must be 1-255 chars and match ${VALID_CONFIG_KEY_REGEX.source}.` });
    return;
  }

  // 2. Security Filter (as before)
  const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key)) && !ALLOWED_CONFIG_KEYS.includes(key);

  if (isSensitive) {
    auditLogger.logEvent(
      'CONFIG_ACCESS_DENIED',
      { key, reason: 'Sensitive key access restricted' },
      undefined, req.ip, 'FAILURE', correlationId
    );
    res.status(403).json({ error: 'Access to this configuration key is restricted.' });
    return;
  }

  // 3. Retrieve Configuration Value (as before)
  const value = configManager.get(key);

  if (value !== undefined) {
    auditLogger.logEvent(
      'CONFIG_ACCESS_SUCCESS',
      { key /* value: value */ },
      undefined, req.ip, 'SUCCESS', correlationId
    );
    res.status(200).json({ key, value });
  } else {
    auditLogger.logEvent(
      'CONFIG_ACCESS_NOT_FOUND',
      { key },
      undefined, req.ip, 'INFO', correlationId
    );
    res.status(404).json({ error: `Configuration key '${key}' not found.` });
  }
});


// Start server
app.listen(PORT, () => {
  auditLogger.logSystemActivity(`Server is running on port ${PORT}`, { port: PORT, environment: process.env.NODE_ENV || 'development' }, 'info');
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`Config access (example): http://localhost:${PORT}/config/appName`);
  console.log(`Config access (example allowed sensitive pattern): http://localhost:${PORT}/config/healthCheck.testKey`);
});

// Basic error handler (optional, but good practice)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => { // Added NextFunction type
    auditLogger.logSystemActivity('Unhandled Express Error', {
        errorMessage: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        correlationId: req.headers['x-correlation-id'] as string | undefined
    }, 'error');
    if (res.headersSent) { // If headers already sent, delegate to default Express error handler
        return next(err);
    }
    res.status(500).send('Something broke!');
});


export default app; // Export for potential testing or programmatic use
