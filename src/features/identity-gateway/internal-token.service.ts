import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createHash, createPrivateKey, createPublicKey, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';

import type { IInternalTokenClaims } from '@app/types';

import type { AllConfigType } from '@config/config.type';

const SIGNING_ALGORITHM = 'ES256';

export interface PublicJwk {
    kty: string;
    crv: string;
    x: string;
    y: string;
    kid: string;
    alg: typeof SIGNING_ALGORITHM;
    use: 'sig';
}

export interface IssuedToken {
    token: string;
    expiresAt: Date;
}

/**
 * Mints the platform's internal JWT (Architecture §13.1): the one token shape every downstream service
 * verifies, whatever credential the caller presented. Signed ES256; the public half is published as a
 * JWKS so services verify offline. `kid` is the RFC 7638 thumbprint, so it is stable for a given key and
 * changes automatically when the key is rotated.
 */
@Injectable()
export class InternalTokenService {
    private readonly privateKey: KeyObject;
    private readonly publicJwk: PublicJwk;
    private readonly issuer: string;
    private readonly audience: string;
    private readonly ttlSeconds: number;

    constructor(configService: ConfigService<AllConfigType>) {
        const tokenIssuer = configService.getOrThrow('tokenIssuer', { infer: true });
        const auth = configService.getOrThrow('auth', { infer: true });

        this.privateKey = createPrivateKey(tokenIssuer.privateKeyPem);
        this.publicJwk = this.toPublicJwk(this.privateKey);
        this.issuer = auth.internalIssuer;
        this.audience = auth.internalAudience;
        this.ttlSeconds = tokenIssuer.ttlSeconds;
    }

    /** Signs the claims; the token never outlives `notAfter` (e.g. the credential it was exchanged for). */
    issue(subject: string, claims: IInternalTokenClaims, notAfter?: Date): IssuedToken {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const capSeconds = notAfter ? Math.floor(notAfter.getTime() / 1000) - nowSeconds : this.ttlSeconds;
        const lifetime = Math.max(1, Math.min(this.ttlSeconds, capSeconds));

        const token = jwt.sign({ ...claims }, this.privateKey, {
            algorithm: SIGNING_ALGORITHM,
            keyid: this.publicJwk.kid,
            issuer: this.issuer,
            audience: this.audience,
            subject,
            expiresIn: lifetime
        });
        return { token, expiresAt: new Date((nowSeconds + lifetime) * 1000) };
    }

    jwks(): { keys: PublicJwk[] } {
        return { keys: [this.publicJwk] };
    }

    private toPublicJwk(privateKey: KeyObject): PublicJwk {
        const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
        if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
            throw new Error('INTERNAL_JWT_PRIVATE_KEY must be an EC P-256 key (ES256)');
        }
        const thumbprintInput = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
        const kid = createHash('sha256').update(thumbprintInput).digest('base64url');
        return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: SIGNING_ALGORITHM, use: 'sig' };
    }
}
