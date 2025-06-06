// tests/integration/mainframe.test.ts
import request from 'supertest';
import app from '../../src/index'; // Import the Express app

describe('GET /api/v1/mainframe/data Integration Tests', () => {

  it('should return 401 Unauthorized if no Authorization header is provided', async () => {
    const response = await request(app).get('/api/v1/mainframe/data');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authorization header missing.');
  });

  it('should return 401 Unauthorized for invalid Basic Auth credentials (mocked RACF failure)', async () => {
    const basicToken = Buffer.from('wronguser:wrongpass').toString('base64');
    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Basic ${basicToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication failed.');
    // The detail comes from our mock RacfIntegrationService
    expect(response.body.details).toContain('Invalid credentials or user not found in RACF (mock).');
  });

  it('should return 200 OK and data for valid Basic Auth credentials (mocked RACF success)', async () => {
    const authUser = 'testracfuser';
    const authPass = 'racfpassword';
    const basicToken = Buffer.from(`${authUser}:${authPass}`).toString('base64');

    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Basic ${basicToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Successfully accessed protected mainframe data.');
    expect(response.body.user).toBeDefined();
    expect(response.body.user.id).toBe(authUser);
    expect(response.body.user.groups).toEqual(['RACFGRP1', 'USERS']); // From mock RacfService
    expect(response.body.data).toBeDefined();
    expect(response.body.data.records).toEqual(["record1_data", "record2_data"]);
  });

  it('should return 200 OK and data for valid Bearer token (mocked RACF success)', async () => {
    const token = 'valid-racf-token'; // This token is recognized by mock RacfService

    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Successfully accessed protected mainframe data.');
    expect(response.body.user).toBeDefined();
    expect(response.body.user.id).toBe('tokenuser'); // Mock RacfService resolves this
    expect(response.body.user.groups).toEqual(['TOKENGRP']);
  });

  it('should return 401 Unauthorized for an invalid Bearer token', async () => {
    const token = 'invalid-racf-token';

    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication failed.');
  });

  it('should be rate-limited for /api/v1/mainframe/data', async () => {
    const endpoint = '/api/v1/mainframe/data';
    // Use valid credentials to pass auth and actually hit rate limiter for this route
    const authUser = 'testracfuser';
    const authPass = 'racfpassword';
    const basicToken = Buffer.from(`${authUser}:${authPass}`).toString('base64');

    const maxRequests = 15; // Must match mainframeRouteRateLimitConfig in index.ts

    const promises = [];
    for (let i = 0; i < maxRequests; i++) {
      promises.push(
        request(app).get(endpoint).set('Authorization', `Basic ${basicToken}`)
      );
    }
    const responses = await Promise.all(promises);
    responses.forEach(res => {
      expect(res.status).toBe(200); // Expect 200 for allowed requests
    });

    // Next request should be rate limited
    const limitedResponse = await request(app).get(endpoint).set('Authorization', `Basic ${basicToken}`);
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body.error).toBe('Too Many Requests. Please try again later.');
  });
});
