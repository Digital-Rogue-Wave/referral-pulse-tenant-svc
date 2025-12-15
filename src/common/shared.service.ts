import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SharedService {
    // API Key constants
    private readonly KEY_PREFIX = 'sk_live_';
    private readonly KEY_LENGTH = 32; // bytes (will be 64 hex chars)
    private readonly BCRYPT_ROUNDS = 10;

    constructor(
        //private jwtService: JwtService,
        private configService: ConfigService<AllConfigType>
    ) {}

    /**
     * Generate a cryptographically secure API key
     */
    generateSecureApiKey(): string {
        const randomBytes = crypto.randomBytes(this.KEY_LENGTH);
        const randomHex = randomBytes.toString('hex');
        return `${this.KEY_PREFIX}${randomHex}`;
    }

    /**
     * Hash an API key using bcrypt
     */
    async hashApiKey(rawKey: string): Promise<string> {
        return await bcrypt.hash(rawKey, this.BCRYPT_ROUNDS);
    }

    /**
     * Extract the prefix from an API key for identification
     */
    extractApiKeyPrefix(rawKey: string): string {
        // Return first 20 characters (sk_live_ + first few random chars)
        return rawKey.substring(0, 20);
    }

    /**
     * Get default tenant settings
     * @deprecated Moved to TenantSettingService
     */
    // getDefaultTenantSettings removed - logic moved to TenantSettingService

    /*
  async getTokensData(data: {
    id: UserEntity['id'];
    role: UserEntity['role'];
  }) {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });
    const tokenExpires = Date.now() + ms(tokenExpiresIn as unknown as number);
    const [accessToken, refreshToken] = await Promise.all([
      await this.jwtService.signAsync(
        {
          id: data.id,
          role: data.role,
        },
        {
          secret: this.configService.getOrThrow('auth.secret', { infer: true }),
          expiresIn: tokenExpiresIn,
        },
      ),
      await this.jwtService.signAsync(
        {
          id: data.id,
          role: data.role,
        },
        {
          secret: this.configService.getOrThrow('auth.refreshSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow('auth.refreshExpires', {
            infer: true,
          }),
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenExpires: Number(tokenExpires),
    };
  }
  async getAccessTokensData(data: {
    id: UserEntity['id'];
    role: UserEntity['role'];
  }) {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });

    const tokenExpires = Date.now() + ms(tokenExpiresIn as unknown as number);

    const accessToken = await this.jwtService.signAsync(
      {
        id: data.id,
        role: data.role,
      },
      {
        secret: this.configService.getOrThrow('auth.secret', { infer: true }),
        expiresIn: tokenExpiresIn,
      },
    );

    return {
      accessToken,
      tokenExpires: Number(tokenExpires),
    };
  }*/
}
