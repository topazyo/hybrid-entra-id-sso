// src/services/ConfigurationManager.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from './AuditLogger';
import fs from 'fs'; // Import fs module for file operations
import path from 'path'; // Import path module for robust path handling (optional but good)

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

  // ... (get, set, getAll, loadFromEnv methods as before)
  public get<T = any>(key: string, defaultValue?: T): T | undefined {
    const value = this.config[key];
    if (value === undefined && defaultValue !== undefined) {
      this.auditLogger.logSystemActivity('Configuration key not found, returning default value', { key, defaultValueProvided: true }, 'warn');
      return defaultValue;
    }
    this.auditLogger.logSystemActivity('Configuration key accessed', { key, found: value !== undefined });
    return value;
  }

  public set(key: string, value: any): void {
    this.config[key] = value;
    this.auditLogger.logSystemActivity('Configuration key set', { key });
  }

  public getAll(): Record<string, any> {
    return { ...this.config }; // Return a copy
  }

  public loadFromEnv(prefix: string = 'APP_CONFIG_'): void {
    let loadedCount = 0;
    this.auditLogger.logSystemActivity('Attempting to load configuration from environment variables', { prefix });
    for (const envVar in process.env) {
      if (envVar.startsWith(prefix)) {
        const key = envVar.substring(prefix.length).toLowerCase().replace(/__/g, '.');
        const value = process.env[envVar];
        this.config[key] = value; // Env vars override existing of same key
        loadedCount++;
        this.auditLogger.logSystemActivity('Loaded configuration from env var', { envVar, key });
      }
    }
    if (loadedCount > 0) {
        this.auditLogger.logSystemActivity(`Loaded ${loadedCount} keys from environment variables with prefix ${prefix}`, { count: loadedCount }, 'info');
    } else {
        this.auditLogger.logSystemActivity(`No environment variables found with prefix ${prefix}`, { prefix }, 'warn');
    }
  }

  public loadFromFile(filePath: string): boolean { // Return boolean for success/failure
    this.auditLogger.logSystemActivity('Attempting to load configuration from file', { filePath });
    try {
      // Resolve path relative to current working directory or use an absolute path
      const resolvedPath = path.resolve(filePath); // Makes path handling more robust
      if (!fs.existsSync(resolvedPath)) {
          this.auditLogger.logSystemActivity('Configuration file not found', { filePath: resolvedPath }, 'error');
          return false;
      }
      const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
      const parsedConfig = JSON.parse(fileContent);

      if (typeof parsedConfig !== 'object' || parsedConfig === null) {
        this.auditLogger.logSystemActivity('Invalid configuration format in file (not an object)', { filePath: resolvedPath }, 'error');
        return false;
      }

      // Merge: Keys from file override existing keys
      this.config = { ...this.config, ...parsedConfig };
      const loadedKeys = Object.keys(parsedConfig);
      this.auditLogger.logSystemActivity(`Successfully loaded ${loadedKeys.length} keys from configuration file`, { filePath: resolvedPath, keysLoaded: loadedKeys });
      return true;
    } catch (error: any) {
      this.auditLogger.logSystemActivity('Failed to load or parse configuration file', { filePath, errorName: error.name, errorMessage: error.message }, 'error');
      return false;
    }
  }
}
