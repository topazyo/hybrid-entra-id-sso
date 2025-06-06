// tests/integration/config.test.ts
import request from 'supertest';
import app from '../../src/index'; // Import the Express app
import { ConfigurationManager } from '../../src/services/ConfigurationManager'; // To potentially set test values

// Helper to get the ConfigurationManager instance used by the app.
// This is a bit of a hack for testing. In a real DI setup, this would be easier.
// We are assuming ConfigurationManager is instantiated early in src/index.ts and is somewhat accessible
// or that we can set environment variables that it will pick up.
// For this test, we will rely on environment variables or default values set in src/index.ts
// For instance, 'appName', 'appVersion', 'defaultPort', 'healthCheck.testKey' are set in src/index.ts's configManager.

describe('GET /config/:key Integration Tests', () => {
  // No beforeAll/afterAll needed if app can be imported multiple times or supertest handles server well.

  it('should return 200 OK and the value for an allowed, existing key', async () => {
    const key = 'appName'; // This key is set in src/index.ts's configManager
    const response = await request(app).get(`/config/${key}`);

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.key).toBe(key);
    expect(response.body.value).toBe('HybridEntraIdSsoSuite'); // Value set in src/index.ts auditLogger global context, also often a config
  });

  it('should return 200 OK for another allowed key like defaultPort', async () => {
    const key = 'defaultPort'; // This key is set in src/index.ts's configManager
    const response = await request(app).get(`/config/${key}`);

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.key).toBe(key);
    expect(response.body.value).toBe(3000); // Default value set in src/index.ts
  });

  it('should return 404 Not Found for a non-existent key', async () => {
    const key = 'thisKeyDoesNotExist123';
    const response = await request(app).get(`/config/${key}`);

    expect(response.status).toBe(404);
    expect(response.body).toBeDefined();
    expect(response.body.error).toBe(`Configuration key '${key}' not found.`);
  });

  it('should return 403 Forbidden for a sensitive key pattern (e.g., contains "password")', async () => {
    // We need to ensure a key like this isn't in ALLOWED_CONFIG_KEYS for the test to be valid
    // Let's assume 'db.password' is not in ALLOWED_CONFIG_KEYS
    const key = 'db.password';
    // To make this test fully reliable, we'd need to ensure configManager in the app
    // actually *has* this key, otherwise it might 404 first.
    // However, the security filter in src/index.ts should trigger before the get attempt.
    // Let's simulate this key existing in environment to be sure it's not a 404.
    // This is tricky in integration tests without direct access to the app's configManager instance.
    // The filter in index.ts for /config/:key *should* deny based on pattern first.

    const response = await request(app).get(`/config/${key}`);

    expect(response.status).toBe(403);
    expect(response.body).toBeDefined();
    expect(response.body.error).toBe('Access to this configuration key is restricted.');
  });

  it('should return 403 Forbidden for another sensitive key pattern (e.g., contains "secret")', async () => {
    const key = 'api.secretToken';
    const response = await request(app).get(`/config/${key}`);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Access to this configuration key is restricted.');
  });

  it('should return 200 OK for an explicitly allowed key even if it matches a sensitive pattern', async () => {
    // 'healthCheck.testKey' is in ALLOWED_CONFIG_KEYS and contains 'Key'
    // This key is set in src/index.ts for configManager
    const key = 'healthCheck.testKey';
    const response = await request(app).get(`/config/${key}`);

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.key).toBe(key);
    expect(response.body.value).toBe('healthyValue123'); // Value set in src/index.ts
  });

  // Test for a key loaded from a file (conceptual, requires file to exist in a known location for the running app)
  // For this to work, src/index.ts would need to call configManager.loadFromFile('path/to/some/test-file.json')
  // And 'path/to/some/test-file.json' would need to exist with content like: {"fileKeyForTest": "valueFromFile"}
  // And 'fileKeyForTest' should not be sensitive or be in ALLOWED_CONFIG_KEYS.
  it.todo('should return 200 OK for a key loaded from a file');
  /*
  // Example if file loading was part of app startup in src/index.ts:
  // Assume src/index.ts had: configManager.loadFromFile('test-data/sample-config.json');
  // And test-data/sample-config.json had: { "fileLoadedKey": "file_value_1" }
  // And "fileLoadedKey" is not sensitive.
  it('should return 200 OK for a key loaded from a file', async () => {
    const key = 'fileLoadedKey';
    const response = await request(app).get(`/config/${key}`);
    expect(response.status).toBe(200);
    expect(response.body.value).toBe('file_value_1');
  });
  */
});
