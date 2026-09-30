/**
 * JWT Helper for BDD tests
 *
 * Two throw-away key pairs are generated once per run:
 * - an EC P-256 key standing in for tenant-service's internal-JWT signing key (INTERNAL_JWT_PRIVATE_KEY is
 *   set from it before the app boots, and nock serves its public half at AUTH_INTERNAL_JWKS_URI) — every
 *   dashboard request is authenticated with an internal JWT, exactly as behind the gateway;
 * - an RSA key standing in for Ory Hydra, used only for client-credentials (service) tokens.
 *
 * The real JwtStrategy/jwks-rsa validates both, so no guard is mocked.
 */

import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

import { ALL_PERMISSIONS } from '../../../src/common/auth/authz/permission-catalog';

// ─── Keys (generated once per test run) ───────────────────────────────────────

const internalKey = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const hydraKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const INTERNAL_KID = 'bdd-internal-key-1';
const HYDRA_KID = 'bdd-hydra-key-1';
const INTERNAL_ISSUER = 'referralai-tenant-svc';
const INTERNAL_AUDIENCE = 'referralai-internal';
const HYDRA_ISSUER = 'http://localhost:4444/';
const HYDRA_AUDIENCE = 'test-audience';

/** The default tenant's Owner, seeded by the hooks so membership-aware services find an acting user. */
export const BDD_OWNER = { userId: 'user-bdd-001', kratosIdentityId: 'kratos-bdd-owner', email: 'owner-bdd@acme.com' } as const;

/** Base64 PEM for INTERNAL_JWT_PRIVATE_KEY — the app signs with the same key the tests do. */
export const internalPrivateKeyBase64 = Buffer.from(internalKey.privateKey).toString('base64');

// ─── JWKS exports ─────────────────────────────────────────────────────────────

const jwksFor = (publicKeyPem: string, kid: string, alg: string): { keys: object[] } => ({
    keys: [{ ...(crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' }) as Record<string, unknown>), alg, use: 'sig', kid }]
});

export const buildInternalJwks = (): { keys: object[] } => jwksFor(internalKey.publicKey, INTERNAL_KID, 'ES256');
export const buildHydraJwks = (): { keys: object[] } => jwksFor(hydraKey.publicKey, HYDRA_KID, 'RS256');

// ─── Token factories ──────────────────────────────────────────────────────────

interface InternalClaims {
    tenant_id: string | null;
    user_id: string | null;
    identity_id: string | null;
    email: string | null;
    perms: string[];
}

function signInternal(claims: InternalClaims, expiresInSeconds = 3600): string {
    return jwt.sign({ source: 'dashboard', key_type: null, key_id: null, ...claims }, internalKey.privateKey, {
        algorithm: 'ES256',
        keyid: INTERNAL_KID,
        issuer: INTERNAL_ISSUER,
        audience: INTERNAL_AUDIENCE,
        subject: claims.user_id ? `user:${claims.user_id}` : `identity:${claims.identity_id}`,
        expiresIn: expiresInSeconds
    });
}

/**
 * The internal JWT a dashboard user of the tenant receives from the gateway. Defaults to the seeded
 * Owner with the full permission snapshot; high-risk permissions are still re-checked against Keto (nock).
 */
export function makeActiveUserToken(tenantId: string, userId: string = BDD_OWNER.userId, perms: string[] = [...ALL_PERMISSIONS]): string {
    return signInternal({ tenant_id: tenantId, user_id: userId, identity_id: BDD_OWNER.kratosIdentityId, email: null, perms });
}

/** An Ory identity with no membership yet (an invitee): no tenant, no permissions — tenant-optional routes only. */
export function makeInviteeToken(email: string, kratosId = 'kratos-invitee-bdd'): string {
    return signInternal({ tenant_id: null, user_id: null, identity_id: kratosId, email, perms: [] });
}

/** An internal JWT that has already expired. */
export function makeExpiredToken(tenantId: string): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        {
            source: 'dashboard',
            tenant_id: tenantId,
            user_id: 'user-expired-001',
            identity_id: null,
            email: null,
            key_type: null,
            key_id: null,
            perms: [],
            iat: now - 7200,
            exp: now - 3600
        },
        internalKey.privateKey,
        { algorithm: 'ES256', keyid: INTERNAL_KID, issuer: INTERNAL_ISSUER, audience: INTERNAL_AUDIENCE }
    );
}

/** A Hydra client-credentials token — a service calling tenant-service on the mesh (tenant-less by design). */
export function makeServiceToken(clientId = 'svc-bdd-client'): string {
    return jwt.sign({ client_id: clientId }, hydraKey.privateKey, {
        algorithm: 'RS256',
        keyid: HYDRA_KID,
        issuer: HYDRA_ISSUER,
        audience: HYDRA_AUDIENCE,
        subject: clientId,
        expiresIn: 3600
    });
}
