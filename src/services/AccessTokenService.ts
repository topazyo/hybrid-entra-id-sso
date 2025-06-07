// src/services/AccessTokenService.ts
import { AuditLogger, LogProvider, ConsoleLogProvider } from './AuditLogger';

export interface TokenClaims {
  [key: string]: any; // Standard claims like 'exp', 'iat', plus custom ones
  sub?: string; // Subject (usually userId)
  iss?: string; // Issuer
  aud?: string; // Audience
}

export interface VerificationResult {
  isValid: boolean;
  userId?: string;
  claims?: TokenClaims;
  error?: string; // e.g., 'expired', 'invalid_signature', 'malformed'
}

const MOCK_JWT_ISSUER = 'HybridSsoSuiteMockIssuer';
const MOCK_JWT_AUDIENCE = 'HybridSsoSuiteMockAudience';
const MOCK_JWT_SECRET_FOR_SIGNATURE_SIMULATION = "super_secret_key_for_mock_jwt"; // Not actually used for crypto

export class AccessTokenService {
  private auditLogger: AuditLogger;
  private tokenExpirationSeconds: number;

  constructor(logProvider?: LogProvider, tokenExpirationSeconds: number = 3600) { // Default 1 hour
    this.auditLogger = new AuditLogger(logProvider || new ConsoleLogProvider());
    this.auditLogger.setGlobalContext('service', 'AccessTokenService');
    this.tokenExpirationSeconds = tokenExpirationSeconds;
    this.auditLogger.logSystemActivity('AccessTokenService initialized', { defaultTokenExpirationSeconds: this.tokenExpirationSeconds });
  }

  /**
   * Generates a conceptual (mock) JWT.
   * In a real implementation, use a library like 'jsonwebtoken'.
   */
  public async generateToken(userId: string, customClaims?: Record<string, any>): Promise<string> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + this.tokenExpirationSeconds;

    const claims: TokenClaims = {
      ...customClaims,
      sub: userId,
      iss: MOCK_JWT_ISSUER,
      aud: MOCK_JWT_AUDIENCE,
      iat: issuedAt,
      exp: expiresAt,
      jti: `mock-jwt-id-${Date.now()}-${Math.random().toString(16).substring(2)}` // Unique token ID
    };

    // Mock JWT structure: header.payload.signature_placeholder
    const mockHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const mockPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    // Simulate a signature part - not cryptographically secure, just for structure
    const mockSignature = Buffer.from(`signed_with_${MOCK_JWT_SECRET_FOR_SIGNATURE_SIMULATION}`).toString('base64url');

    const mockToken = `${mockHeader}.${mockPayload}.${mockSignature}`;

    this.auditLogger.logEvent(
      'ACCESS_TOKEN_GENERATED',
      { userId, expiresAt: new Date(expiresAt * 1000).toISOString(), claimsKeys: Object.keys(claims) },
      userId, undefined, 'SUCCESS'
    );
    return mockToken;
  }

  /**
   * Verifies a conceptual (mock) JWT.
   * In a real implementation, use a library like 'jsonwebtoken' with proper signature verification.
   */
  public async verifyToken(token: string): Promise<VerificationResult> {
    this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_ATTEMPT', { tokenLength: token.length }, undefined, undefined, 'PENDING');

    const parts = token.split('.');
    if (parts.length !== 3) {
      this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_FAILURE', { reason: 'Malformed token (not 3 parts)' }, undefined, undefined, 'FAILURE');
      return { isValid: false, error: 'malformed_token' };
    }

    const mockHeaderEncoded = parts[0];
    const mockPayloadEncoded = parts[1];
    const mockSignatureEncoded = parts[2]; // We don't actually verify this against the secret in mock

    try {
      const header = JSON.parse(Buffer.from(mockHeaderEncoded, 'base64url').toString());
      if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_FAILURE', { reason: 'Invalid mock header content' }, undefined, undefined, 'FAILURE');
        return { isValid: false, error: 'invalid_mock_header' };
      }

      const claims = JSON.parse(Buffer.from(mockPayloadEncoded, 'base64url').toString()) as TokenClaims;

      // Check mock signature placeholder
      const expectedSignature = Buffer.from(`signed_with_${MOCK_JWT_SECRET_FOR_SIGNATURE_SIMULATION}`).toString('base64url');
      if (mockSignatureEncoded !== expectedSignature) {
          this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_FAILURE', { reason: 'Invalid mock signature' }, claims.sub, undefined, 'FAILURE');
          return { isValid: false, error: 'invalid_mock_signature', userId: claims.sub, claims };
      }

      // Check expiration
      if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
        this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_FAILURE', { reason: 'Token expired', userId: claims.sub }, claims.sub, undefined, 'FAILURE');
        return { isValid: false, error: 'token_expired', userId: claims.sub, claims };
      }

      // Check issuer and audience (optional, but good practice)
      if (claims.iss !== MOCK_JWT_ISSUER) {
        this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_FAILURE', { reason: 'Invalid issuer', userId: claims.sub }, claims.sub, undefined, 'FAILURE');
        return { isValid: false, error: 'invalid_issuer', userId: claims.sub, claims };
      }
      // if (claims.aud !== MOCK_JWT_AUDIENCE) { // Can add audience check too
      //   this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_FAILURE', { reason: 'Invalid audience' }, claims.sub, undefined, 'FAILURE');
      //   return { isValid: false, error: 'invalid_audience', userId: claims.sub, claims };
      // }

      this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_SUCCESS', { userId: claims.sub, claimsKeys: Object.keys(claims) }, claims.sub, undefined, 'SUCCESS');
      return { isValid: true, userId: claims.sub, claims };

    } catch (error: any) {
      this.auditLogger.logEvent('ACCESS_TOKEN_VERIFICATION_FAILURE', { reason: 'Malformed payload/header JSON', error: error.message }, undefined, undefined, 'FAILURE');
      return { isValid: false, error: 'malformed_payload_json' };
    }
  }
}
