// tests/integration/auth.test.ts
import request from 'supertest';
import app from '../../src/index'; // Import the Express app
// We assume RacfPasswordProvider is configured with 'testracfuser'/'racfpassword' from previous steps

describe('POST /auth/token Integration Tests', () => {
  const validCredentials = {
    userId: 'testracfuser', // Matches mock RacfPasswordProvider
    password: 'racfpassword',
  };
  const invalidCredentials = {
    userId: 'testracfuser',
    password: 'wrongpassword',
  };

  it('should return 200 OK and a mock token for valid credentials', async () => {
    const response = await request(app)
      .post('/auth/token')
      .send(validCredentials);

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.access_token).toBeDefined();
    expect(typeof response.body.access_token).toBe('string');
    expect(response.body.access_token.split('.').length).toBe(3); // Mock JWT format
    expect(response.body.token_type).toBe('Bearer');
    expect(response.body.user).toBeDefined();
    expect(response.body.user.provider).toBe('RacfPasswordProvider'); // From mock provider detail
    expect(response.body.user.groups).toEqual(['RACFGRP1', 'USERS']); // From mock RacfService via provider
  });

  it('should return 401 Unauthorized for invalid credentials', async () => {
    const response = await request(app)
      .post('/auth/token')
      .send(invalidCredentials);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication failed.');
    expect(response.body.details).toBeDefined(); // Contains error from AuthChain/Provider
    expect(response.body.details.code).toBe('AUTH_FAILED_RACF');
  });

  it('should return 400 Bad Request if userId is missing', async () => {
    const response = await request(app)
      .post('/auth/token')
      .send({ password: 'somepassword' }); // Missing userId

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('userId and password are required');
  });

  it('should return 400 Bad Request if password is missing', async () => {
    const response = await request(app)
      .post('/auth/token')
      .send({ userId: 'someuser' }); // Missing password

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('userId and password are required');
  });

  it('should return 400 Bad Request if userId is not a string', async () => {
    const response = await request(app)
      .post('/auth/token')
      .send({ userId: 123, password: 'somepassword' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('userId and password are required');
  });

  it('should be rate limited after exceeding configured attempts', async () => {
    const maxRequests = 5; // Must match authTokenRateLimitConfig in index.ts

    for (let i = 0; i < maxRequests; i++) {
      const res = await request(app).post('/auth/token').send(validCredentials);
      // Allow 200 or 401 for this loop, just exhausting attempts
      expect(res.status).toBe(200); // Assuming valid creds for this test
    }

    const limitedResponse = await request(app).post('/auth/token').send(validCredentials);
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body.error).toBe('Too Many Requests. Please try again later.');
  });
});
