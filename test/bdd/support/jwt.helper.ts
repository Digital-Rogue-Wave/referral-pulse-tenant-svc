/**
 * JWT Helper for BDD tests
 *
 * Generates a throw-away RSA-2048 key pair once at module load.
 * All test tokens are signed with this private key.
 * nock serves the matching public key as a JWKS response so that
 * the real JwtStrategy/jwks-rsa validates tokens without a live Hydra.
 */

import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

// ─── Key pair (generated once per test run) ───────────────────────────────────

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const TEST_KID = 'bdd-test-key-1';
const TEST_ISSUER = 'http://localhost:4444/';
const TEST_AUDIENCE = 'test-audience';

// ─── JWKS export ──────────────────────────────────────────────────────────────

/**
 * The JWKS JSON that nock serves at /.well-known/jwks.json
 * Uses Node.js native JWK export (available since Node 16).
 */
export function buildJwks(): { keys: object[] } {
    const keyObj = crypto.createPublicKey(publicKey);
    const jwk = keyObj.export({ format: 'jwk' }) as Record<string, unknown>;

    return {
        keys: [
            {
                ...jwk,
                alg: 'RS256',
                use: 'sig',
                kid: TEST_KID
            }
        ]
    };
}

// ─── Token factories ──────────────────────────────────────────────────────────

interface TokenClaims {
    sub?: string;
    exp?: number;
    tenantId?: string;
    // service token fields
    client_id?: string;
    grant_type?: string;
}

function sign(claims: TokenClaims & Record<string, unknown>): string {
    const { exp, ...rest } = claims;
    return jwt.sign(
        {
            iss: TEST_ISSUER,
            aud: TEST_AUDIENCE,
            iat: Math.floor(Date.now() / 1000),
            ...rest
        },
        privateKey,
        {
            algorithm: 'RS256',
            keyid: TEST_KID,
            ...(exp !== undefined ? { expiresIn: exp - Math.floor(Date.now() / 1000) } : { expiresIn: 3600 })
        }
    );
}

/**
 * A valid user token for a human user belonging to the given tenant.
 * Uses ext.tenant_id path matching AUTH_TENANT_CLAIM_PATH=ext.tenant_id
 */
export function makeActiveUserToken(tenantId: string, userId = 'user-bdd-001'): string {
    return sign({
        sub: userId,
        ext: {
            tenant_id: tenantId,
            user_id: userId,
            roles: ['member']
        }
    });
}

/**
 * A token that has already expired.
 */
export function makeExpiredToken(tenantId: string): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        {
            sub: 'user-expired-001',
            iss: TEST_ISSUER,
            aud: TEST_AUDIENCE,
            iat: now - 7200,
            exp: now - 3600, // expired 1 hour ago
            ext: {
                tenant_id: tenantId,
                user_id: 'user-expired-001'
            }
        },
        privateKey,
        { algorithm: 'RS256', keyid: TEST_KID }
    );
}

/**
 * A service token (client_credentials grant).
 * JwtStrategy.isServiceToken() returns true because grant_type === 'client_credentials'
 */
export function makeServiceToken(tenantId?: string): string {
    return sign({
        sub: 'svc-bdd-client',
        client_id: 'svc-bdd-client',
        grant_type: 'client_credentials',
        ...(tenantId ? { ext: { tenant_id: tenantId } } : {})
    });
}
