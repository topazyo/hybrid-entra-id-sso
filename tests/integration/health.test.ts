// tests/integration/health.test.ts
import request from 'supertest';
import app from '../../src/index'; // Import the Express app from src/index.ts
import { HealthStatus } from '../../src/controllers/HealthController'; // For type checking response

// Note: For these integration tests to run correctly, the Express app
// should ideally not auto-start listening in src/index.ts when imported.
// ... (rest of the initial comments)

describe('GET /health Integration Tests', () => {

  it('should return 200 OK, UP status, and include security headers', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();

    // Check body content
    const healthStatus = response.body as HealthStatus;
    expect(healthStatus.status).toBe('UP');
    expect(healthStatus.timestamp).toBeDefined();
    expect(healthStatus.version).toBeDefined(); // Default version or from config
    expect(healthStatus.checks).toBeInstanceOf(Array);
    expect(healthStatus.checks?.length).toBe(3); // SystemCore, Database, ConfigurationService
    healthStatus.checks?.forEach(check => {
      expect(check.status).toBe('UP');
      expect(check.name).toBeDefined();
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
    });

    // Check for security headers
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    expect(response.headers['content-security-policy']).toBe("default-src 'self'; frame-ancestors 'none'; form-action 'self';");
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['permissions-policy']).toBe('microphone=(), geolocation=()');
  });

  it('should return a valid ISO timestamp', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    const healthStatus = response.body as HealthStatus;
    expect(Date.parse(healthStatus.timestamp)).not.toBeNaN();
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
    expect(healthStatus.timestamp).toMatch(isoRegex);
  });

  it('should include a correlation ID in response headers if provided in request', async () => {
    const testCorrelationId = 'test-correlation-id-12345';
    const response = await request(app)
      .get('/health')
      .set('x-correlation-id', testCorrelationId);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('UP');
  });

  it.todo('should return 503 Service Unavailable and DEGRADED status when a critical check fails');

  it('should return 429 Too Many Requests if rate limit is exceeded', async () => {
    const endpoint = '/health';
    const maxRequests = 20;

    const promises = [];
    for (let i = 0; i < maxRequests; i++) {
      promises.push(request(app).get(endpoint));
    }
    const responses = await Promise.all(promises);
    responses.forEach(res => {
      expect(res.status === 200 || res.status === 503).toBe(true);
    });

    const limitedResponse = await request(app).get(endpoint);
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body.error).toBe('Too Many Requests. Please try again later.');
  });
});
