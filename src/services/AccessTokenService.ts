import { Logger } from '../utils/Logger';
import { CryptoService } from './CryptoService';
import { CacheManager } from './CacheManager';

interface TokenMetadata {
  userId: string;
  scope: string[];
  expiresAt: Date;
  refreshToken?: string;
  deviceId?: string;
  ipAddress?: string;
}

export class AccessTokenService {
  private logger: Logger;
  private crypto: CryptoService;
  private cache: CacheManager;

  constructor() {
    this.logger = new Logger('AccessTokenService');
    this.crypto = new CryptoService();
    this.cache = new CacheManager(process.env.REDIS_URL);
  }

  async generateAccessToken(metadata: TokenMetadata): Promise<TokenResponse> {
    try {
      const accessToken = await this.crypto.generateJWT({
        sub: metadata.userId,
        scope: metadata.scope,
        exp: Math.floor(metadata.expiresAt.getTime() / 1000)
      });

      const refreshToken = metadata.refreshToken || 
        await this.generateRefreshToken(metadata);

      await this.storeTokenMetadata(accessToken, metadata);

      return {
        accessToken,
        refreshToken,
        expiresIn: Math.floor(
          (metadata.expiresAt.getTime() - Date.now()) / 1000
        ),
        scope: metadata.scope
      };
    } catch (error) {
      this.logger.error('Failed to generate access token', { error });
      throw new TokenGenerationError('Failed to generate token', error);
    }
  }

  async validateAccessToken(token: string): Promise<TokenMetadata> {
    try {
      const decoded = await this.crypto.verifyJWT(token);
      const metadata = await this.getTokenMetadata(token);

      if (!metadata) {
        throw new TokenValidationError('Token metadata not found');
      }

      if (new Date() > metadata.expiresAt) {
        throw new TokenValidationError('Token expired');
      }

      return metadata;
    } catch (error) {
      this.logger.error('Token validation failed', { error });
      throw new TokenValidationError('Invalid token', error);
    }
  }

  private async generateRefreshToken(metadata: TokenMetadata): Promise<string> {
    const refreshToken = await this.crypto.generateSecureToken(32);
    await this.storeRefreshToken(refreshToken, metadata);
    return refreshToken;
  }

  private async storeTokenMetadata(
    token: string,
    metadata: TokenMetadata
  ): Promise<void> {
    const key = `token:${token}`;
    await this.cache.set(key, metadata, 
      Math.ceil((metadata.expiresAt.getTime() - Date.now()) / 1000)
    );
  }
}