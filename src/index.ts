// src/index.ts
import express, { Express, Request, Response } from 'express';
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

const healthController = new HealthController(new ConsoleLogProvider(), configManager.get('appVersion', '0.1.0-default')); // Pass LogProvider

const app: Express = express();
const PORT: number = parseInt(configManager.get('port', configManager.get('defaultPort')) as string, 10);

// Middleware (optional for now, but good for future)
app.use(express.json());
// Basic request logging middleware using AuditLogger
app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] || `http-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
  req.headers['x-correlation-id'] = correlationId; // Ensure it's available for downstream

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
    auditLogger.logSystemActivity('Error in /health endpoint', { error: error.message, stack: error.stack }, 'error');
    res.status(500).json({ status: 'ERROR', message: 'Internal server error during health check' });
  }
});

// Start server
app.listen(PORT, () => {
  auditLogger.logSystemActivity(`Server is running on port ${PORT}`, { port: PORT, environment: process.env.NODE_ENV || 'development' }, 'info');
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});

// Basic error handler (optional, but good practice)
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
    auditLogger.logSystemActivity('Unhandled Express Error', {
        errorMessage: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        correlationId: req.headers['x-correlation-id'] as string | undefined
    }, 'error');
    res.status(500).send('Something broke!');
});

export default app; // Export for potential testing or programmatic use
