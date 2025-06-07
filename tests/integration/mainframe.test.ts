// tests/integration/mainframe.test.ts
import request from 'supertest';
import app from '../../src/index'; // Import the Express app
import { AccessTokenService } from '../../src/services/AccessTokenService'; // For test token structure understanding

describe('GET /api/v1/mainframe/data Integration Tests', () => {
  let validUserToken: string; // To store a token for 'testracfuser'

  beforeAll(async () => {
    // Authenticate 'testracfuser' via /auth/token to get a valid Bearer token for other tests
    const response = await request(app)
      .post('/auth/token')
      .send({ userId: 'testracfuser', password: 'racfpassword' });
    if (response.status !== 200 || !response.body.access_token) {
      throw new Error('Failed to obtain a valid token for test setup in beforeAll. Check /auth/token endpoint and RacfPasswordProvider mock.');
    }
    validUserToken = response.body.access_token;
  });

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
    expect(response.body.user.groups).toEqual(['RACFGRP1', 'USERS']);
    expect(response.body.user.authDetails?.provider).toBe('RacfPasswordProvider');
    expect(response.body.data).toBeDefined();
    expect(response.body.data.records).toEqual(["record1_data", "record2_data"]);
  });

  it('should return 200 OK and data for a valid Bearer token obtained via /auth/token', async () => {
    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Bearer ${validUserToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Successfully accessed protected mainframe data.');
    expect(response.body.user).toBeDefined();
    expect(response.body.user.id).toBe('testracfuser'); // Subject of the token
    expect(response.body.user.authDetails?.provider).toBe('BearerTokenAuthProvider');
    // Check for claims that were put into the token by /auth/token endpoint
    expect(response.body.user.authDetails?.claims?.groups).toEqual(['RACFGRP1', 'USERS']);
    expect(response.body.user.authDetails?.claims?.provider).toBe('RacfPasswordProvider'); // This was the provider that initially authenticated to get the token
  });

  it('should return 401 Unauthorized for an invalid/malformed Bearer token', async () => {
    const token = 'invalid-jwt-token';

    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication failed.');
    // Error detail will come from BearerTokenAuthProvider -> AccessTokenService
    expect(response.body.details?.code).toBe('TOKEN_VERIFICATION_FAILED_MALFORMED_TOKEN');
  });

  it('should return 401 Unauthorized for an expired Bearer token', async () => {
    // This test requires manipulating time or generating an already expired token.
    // The AccessTokenService uses Date.now(), so direct manipulation here is tricky for integration.
    // Unit tests for AccessTokenService cover expiration precisely with jest.useFakeTimers().
    // For an integration test, we'd need a way to get an expired token or wait for `validUserToken` to expire.
    // If `validUserToken` has a very short expiry (e.g., 1 second), we could wait.
    // Let's assume the default 1-hour expiry for `validUserToken` from `AccessTokenService`.
    // This test is hard to make reliable in integration without more test hooks.
    // For now, we'll test with a token that is structurally valid but has a past expiry if we could craft one.
    // The current mock AccessTokenService generates tokens that will expire.
    // This test will be more of a placeholder for the concept.

    const ats = new AccessTokenService(undefined, -1); // Negative TTL = already expired
    const expiredToken = await ats.generateToken('expiredUser');

    const response = await request(app)
      .get('/api/v1/mainframe/data')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication failed.');
    expect(response.body.details?.code).toBe('TOKEN_VERIFICATION_FAILED_TOKEN_EXPIRED');
  });


  it('should be rate-limited for /api/v1/mainframe/data', async () => {
    const endpoint = '/api/v1/mainframe/data';
    // Use the validUserToken obtained in beforeAll for rate limit testing
    const maxRequests = 15;

    const promises = [];
    for (let i = 0; i < maxRequests; i++) {
      promises.push(
        request(app).get(endpoint).set('Authorization', `Bearer ${validUserToken}`)
      );
    }
    const responses = await Promise.all(promises);
    responses.forEach(res => {
      expect(res.status).toBe(200);
    });

    const limitedResponse = await request(app).get(endpoint).set('Authorization', `Bearer ${validUserToken}`);
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body.error).toBe('Too Many Requests. Please try again later.');
  });
});
