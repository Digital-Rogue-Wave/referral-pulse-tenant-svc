import { createSign, generateKeyPairSync } from 'crypto';

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { IAuthenticatedUser, IJwtPayload } from '@app/types';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

/**
 * Mock JWT strategy that replaces the real JwtStrategy for tests.
 * Uses a test RSA key pair instead of JWKS, matching the RS256 algo from Ory Hydra.
 *
 * Flow: JwtAuthGuard → Passport → MockJwtStrategy.validate() → Passport sets req.user
 */
@Injectable()
export class MockJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: publicKey,
            algorithms: ['RS256'],
            ignoreExpiration: true
        });
    }

    async validate(payload: IJwtPayload): Promise<IAuthenticatedUser> {
        return {
            userId: payload.sub,
            tenantId: (payload.tenantId as string) ?? '',
            permissions: payload.permissions as string[] | undefined
        };
    }
}

/**
 * Create a signed test JWT (RS256) using Node crypto.
 * Matches the Ory Hydra token format.
 */
export function signTestJwt(claims: { sub: string; tenantId: string; permissions?: string[] }): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${body}`);
    const signature = signer.sign(privateKey, 'base64url');
    return `${header}.${body}.${signature}`;
}