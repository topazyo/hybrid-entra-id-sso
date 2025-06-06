// src/services/ConfigurationManager.test.ts
import { ConfigurationManager } from './ConfigurationManager';
import { AuditLogger, LogProvider } from './AuditLogger';
import fs from 'fs'; // Import fs for mocking
import path from 'path'; // Import path for mocking path.resolve if necessary

// Mock the fs module
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>; // Typesafe mock

// Mock LogProvider for testing AuditLogger within ConfigurationManager
class MockLogProvider implements LogProvider {
  public logs: { level: string, message: string, meta?: any }[] = [];
  info(message: string, meta?: any): void { this.logs.push({ level: 'info', message, meta }); }
  warn(message: string, meta?: any): void { this.logs.push({ level: 'warn', message, meta }); }
  error(message: string, meta?: any): void { this.logs.push({ level: 'error', message, meta }); }
  debug(message: string, meta?: any): void { this.logs.push({ level: 'debug', message, meta }); }
  clearLogs(): void { this.logs = []; }
}

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  let mockLogProvider: MockLogProvider;
  let logSystemActivitySpy: jest.SpyInstance;
  // Keep a reference to original process.env
  const originalEnv = process.env;

  beforeEach(() => {
    mockLogProvider = new MockLogProvider();
    // Spy on AuditLogger.prototype.logSystemActivity before ConfigurationManager instantiation
    logSystemActivitySpy = jest.spyOn(AuditLogger.prototype, 'logSystemActivity');
    configManager = new ConfigurationManager(mockLogProvider);

    // Reset process.env for each test to ensure isolation
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    logSystemActivitySpy.mockRestore();
    mockLogProvider.clearLogs();
    // Restore original process.env
    process.env = originalEnv;
  });

  it('should initialize with an empty configuration and log initialization', () => {
    expect(configManager.getAll()).toEqual({});
    // Constructor of ConfigManager calls logSystemActivity
    expect(logSystemActivitySpy).toHaveBeenCalledWith('Initialized with empty configuration');
  });

  it('should initialize with initial configuration and log it', () => {
    const initialConf = { appName: 'TestApp', version: '1.0' };
    // Need to setup spy again if we are re-instantiating or ensure it's on prototype
    // For this test, create a new instance to test constructor logging properly
    const cm = new ConfigurationManager(mockLogProvider, initialConf);
    expect(cm.get('appName')).toBe('TestApp');
    expect(logSystemActivitySpy).toHaveBeenCalledWith('Initialized with initial configuration', { keys: ['appName', 'version'] });
  });

  describe('get/set', () => {
    it('should set and get a configuration value', () => {
      configManager.set('myKey', 'myValue');
      expect(configManager.get('myKey')).toBe('myValue');
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Configuration key set', { key: 'myKey' });
      // Accessing the key
      configManager.get('myKey');
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Configuration key accessed', { key: 'myKey', found: true });
    });

    it('should return undefined for a non-existent key', () => {
      expect(configManager.get('nonExistentKey')).toBeUndefined();
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Configuration key accessed', { key: 'nonExistentKey', found: false });
    });

    it('should return defaultValue for a non-existent key if provided', () => {
      expect(configManager.get('nonExistentKeyWithDefault', 'defaultVal')).toBe('defaultVal');
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Configuration key not found, returning default value', { key: 'nonExistentKeyWithDefault', defaultValueProvided: true }, 'warn');
    });

    it('getAll should return a copy of the configuration', () => {
        configManager.set('key1', 'val1');
        const allConfig = configManager.getAll();
        expect(allConfig).toEqual({ key1: 'val1' });
        allConfig.key1 = 'changed'; // Modify the copy
        expect(configManager.get('key1')).toBe('val1'); // Original should be unchanged
    });
  });

  describe('loadFromEnv', () => {
    it('should load variables from process.env with a given prefix and transform keys', () => {
      process.env.TEST_CFG_API__URL = 'http://example.com/api'; // Using __ for transformation
      process.env.TEST_CFG_TIMEOUT__MS = '5000'; // Using __ for transformation
      process.env.OTHER_VAR = 'ignore_me';

      configManager.loadFromEnv('TEST_CFG_');

      expect(configManager.get('api.url')).toBe('http://example.com/api');
      expect(configManager.get('timeout.ms')).toBe('5000');
      expect(configManager.get('other_var')).toBeUndefined(); // Not under prefix
      expect(configManager.get('api_url')).toBeUndefined(); // Should be transformed

      expect(logSystemActivitySpy).toHaveBeenCalledWith('Attempting to load configuration from environment variables', { prefix: 'TEST_CFG_' });
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Loaded configuration from env var', { envVar: 'TEST_CFG_API__URL', key: 'api.url' });
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Loaded configuration from env var', { envVar: 'TEST_CFG_TIMEOUT__MS', key: 'timeout.ms' });
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Loaded 2 keys from environment variables with prefix TEST_CFG_', { count: 2 }, 'info');
    });

    it('should handle mixed __ and single _ in env var names correctly', () => {
      process.env.TEST_CFG_USER__NAME = 'testuser';
      process.env.TEST_CFG_USER__ADDRESS__STREET = '123 Main St';
      process.env.TEST_CFG_SERVICE_ENDPOINT = 'http://service'; // Single underscore, should remain as is after prefix removal
      configManager.loadFromEnv('TEST_CFG_');

      expect(configManager.get('user.name')).toBe('testuser');
      expect(configManager.get('user.address.street')).toBe('123 Main St');
      expect(configManager.get('service_endpoint')).toBe('http://service'); // Key remains 'service_endpoint' after prefix removal and lowercasing

      expect(logSystemActivitySpy).toHaveBeenCalledWith('Loaded configuration from env var', { envVar: 'TEST_CFG_USER__NAME', key: 'user.name' });
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Loaded configuration from env var', { envVar: 'TEST_CFG_USER__ADDRESS__STREET', key: 'user.address.street' });
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Loaded configuration from env var', { envVar: 'TEST_CFG_SERVICE_ENDPOINT', key: 'service_endpoint' });
    });

    it('should log a warning if no env vars are found with the prefix', () => {
        configManager.loadFromEnv('NON_EXISTENT_PREFIX_');
        expect(logSystemActivitySpy).toHaveBeenCalledWith('No environment variables found with prefix NON_EXISTENT_PREFIX_', { prefix: 'NON_EXISTENT_PREFIX_' }, 'warn');
    });

    it('should use default prefix "APP_CONFIG_" if none is provided and transform keys', () => {
        process.env.APP_CONFIG_DEFAULT__KEY = 'defaultValue'; // Using __ for transformation
        configManager.loadFromEnv(); // No prefix
        expect(configManager.get('default.key')).toBe('defaultValue');
        expect(logSystemActivitySpy).toHaveBeenCalledWith('Attempting to load configuration from environment variables', { prefix: 'APP_CONFIG_' });
        expect(logSystemActivitySpy).toHaveBeenCalledWith('Loaded configuration from env var', {envVar: 'APP_CONFIG_DEFAULT__KEY', key: 'default.key'});
    });
  });

  describe('loadFromFile', () => {
    const testFilePath = 'config/test-config.json';
    const resolvedTestFilePath = path.resolve(testFilePath); // Match what's used in implementation

    beforeEach(() => {
        // Reset mocks for fs before each test in this describe block
        mockedFs.existsSync.mockReset();
        mockedFs.readFileSync.mockReset();
        // jest.spyOn(JSON, 'parse').mockReset(); // If directly mocking JSON.parse
    });

    it('should load configuration from a valid JSON file and merge it', () => {
      const fileConfig = { 'file.setting': 'loadedFromFile', 'common.setting': 'overriddenByFile' };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      configManager.set('common.setting', 'initialValue');
      configManager.set('existing.setting', 'remainsUnchanged');

      const success = configManager.loadFromFile(testFilePath);
      expect(success).toBe(true);
      expect(configManager.get('file.setting')).toBe('loadedFromFile');
      expect(configManager.get('common.setting')).toBe('overriddenByFile');
      expect(configManager.get('existing.setting')).toBe('remainsUnchanged');
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Attempting to load configuration from file', { filePath: testFilePath });
      expect(logSystemActivitySpy).toHaveBeenCalledWith(`Successfully loaded ${Object.keys(fileConfig).length} keys from configuration file`, { filePath: resolvedTestFilePath, keysLoaded: Object.keys(fileConfig) });
    });

    it('should return false and log error if file not found', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const success = configManager.loadFromFile('nonexistent.json');
      expect(success).toBe(false);
      expect(logSystemActivitySpy).toHaveBeenCalledWith('Configuration file not found', { filePath: path.resolve('nonexistent.json') }, 'error');
    });

    it('should return false and log error if JSON is invalid', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('this is not json');
      // JSON.parse will throw an error
      const success = configManager.loadFromFile(testFilePath);
      expect(success).toBe(false);
      expect(logSystemActivitySpy).toHaveBeenCalledWith(
        'Failed to load or parse configuration file',
        expect.objectContaining({
            filePath: testFilePath,
            errorName: 'SyntaxError' // Or whatever error JSON.parse throws for invalid string
        }),
        'error'
      );
    });

    it('should return false and log error if file content is not an object', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify("a string, not an object"));
      const success = configManager.loadFromFile(testFilePath);
      expect(success).toBe(false);
      expect(logSystemActivitySpy).toHaveBeenCalledWith(
        'Invalid configuration format in file (not an object)',
        { filePath: resolvedTestFilePath },
        'error'
      );
    });

    it('should override existing keys with values from file', () => {
        configManager.set('feature.toggle', 'oldValue');
        const fileConfig = { 'feature.toggle': 'newValueFromFile' };
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

        configManager.loadFromFile(testFilePath);
        expect(configManager.get('feature.toggle')).toBe('newValueFromFile');
    });
  });
});
