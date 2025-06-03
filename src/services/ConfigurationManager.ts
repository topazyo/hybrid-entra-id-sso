// src/services/ConfigurationManager.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from './AuditLogger';

export class ConfigurationManager {
  private config: Record<string, any> = {};
  private auditLogger: AuditLogger;

  constructor(logProvider?: LogProvider, initialConfig?: Record<string, any>) {
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('service', 'ConfigurationManager');

    if (initialConfig) {
      this.config = { ...initialConfig };
      this.auditLogger.logSystemActivity('Initialized with initial configuration', { keys: Object.keys(initialConfig) });
    } else {
      this.auditLogger.logSystemActivity('Initialized with empty configuration');
    }
  }

  public get<T = any>(key: string, defaultValue?: T): T | undefined {
    const value = this.config[key];
    if (value === undefined && defaultValue !== undefined) {
      this.auditLogger.logSystemActivity('Configuration key not found, returning default value', { key, defaultValueProvided: true }, 'warn');
      return defaultValue;
    }
    // Avoid logging sensitive values directly in production by default.
    // For this example, we log that a key was accessed.
    // Consider adding a "sensitiveKeys" list to skip logging values for those.
    this.auditLogger.logSystemActivity('Configuration key accessed', { key, found: value !== undefined });
    return value;
  }

  public set(key: string, value: any): void {
    this.config[key] = value;
    // Avoid logging the actual value if it's sensitive.
    this.auditLogger.logSystemActivity('Configuration key set', { key /*, value: value */ }); // Value commented out for security
  }

  public getAll(): Record<string, any> {
    return { ...this.config }; // Return a copy
  }

  public loadFromEnv(prefix: string = 'APP_CONFIG_'): void {
    let loadedCount = 0;
    this.auditLogger.logSystemActivity('Attempting to load configuration from environment variables', { prefix });
    for (const envVar in process.env) {
      if (envVar.startsWith(prefix)) {
        const key = envVar.substring(prefix.length).toLowerCase().replace(/__/g, '.'); // Example: APP_CONFIG_USER__NAME -> user.name
        const value = process.env[envVar];
        this.config[key] = value;
        loadedCount++;
        this.auditLogger.logSystemActivity('Loaded configuration from env var', { envVar, key /*, value: value */ }); // Value commented out
      }
    }
    if (loadedCount > 0) {
        this.auditLogger.logSystemActivity(`Loaded ${loadedCount} keys from environment variables with prefix ${prefix}`, { count: loadedCount }, 'info');
    } else {
        this.auditLogger.logSystemActivity(`No environment variables found with prefix ${prefix}`, { prefix }, 'warn');
    }
  }

  public loadFromFile(filePath: string): void {
    // Placeholder for loading from a JSON or .env file.
    // This would involve fs.readFileSync and JSON.parse or a dotenv library.
    // For this subtask, we'll keep it simple.
    this.auditLogger.logSystemActivity('loadFromFile method called (not implemented)', { filePath }, 'warn');
    // Example (if implemented):
    // try {
    //   const fileContent = fs.readFileSync(filePath, 'utf-8');
    //   const parsedConfig = JSON.parse(fileContent);
    //   this.config = { ...this.config, ...parsedConfig };
    //   this.auditLogger.logSystemActivity('Configuration loaded from file', { filePath, keys: Object.keys(parsedConfig) });
    // } catch (error: any) {
    //   this.auditLogger.logSystemActivity('Failed to load configuration from file', { filePath, error: error.message }, 'error');
    // }
  }
}
