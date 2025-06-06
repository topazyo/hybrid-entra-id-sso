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
    // The detail comes from our mock RacfIntegrationService via RacfPasswordProvider
    expect(response.body.details.message).toContain('Invalid credentials or user not found in RACF (mock).');
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
    expect(response.body.user.authDetails?.provider).toBe('RacfPasswordProvider');
    expect(response.body.data).toBeDefined();
    expect(response.body.data.records).toEqual(["record1_data", "record2_data"]);
  });

  it('should return 401 for Bearer token when only RacfPasswordProvider is in chain', async () => {
    // This test assumes a Token Provider is NOT yet added to the AuthChain
    // that uses RacfIntegrationService for 'tokenuser' and 'valid-racf-token'.
    // MainframeAuthBridge currently extracts 'user_from_token' as userIdAttempt for Bearer.
    const token = 'valid-racf-token';

    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Bearer ${token}`);

    // Current setup in index.ts only has RacfPasswordProvider in the chain.
    // RacfPasswordProvider expects credentials of type 'password'.
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication failed.');
    // The error detail would come from RacfPasswordProvider indicating credential type mismatch.
    expect(response.body.details?.message || response.body.details?.error?.message).toContain('Password credentials not provided or type mismatch.');
  });

  it('should return 401 Unauthorized for an invalid/unknown Bearer token', async () => {
    const token = 'invalid-racf-token';

    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication failed.');
  });

  it('should be rate-limited for /api/v1/mainframe/data', async () => {
    const endpoint = '/api/v1/mainframe/data';
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
      expect(res.status).toBe(200);
    });

    const limitedResponse = await request(app).get(endpoint).set('Authorization', `Basic ${basicToken}`);
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body.error).toBe('Too Many Requests. Please try again later.');
  });
});
