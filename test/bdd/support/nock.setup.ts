/**
 * nock Interceptors for BDD Tests
 *
 * All external HTTP dependencies are mocked here:
 *  - Internal JWKS (tenant-service's own key, as every service fetches it) — the test EC public key
 *  - Hydra JWKS — the test RSA public key (client-credentials tokens)
 *  - Keto read API — `/relation-tuples/check/openapi` answers { allowed: true } by default
 *  - Kratos admin — identities registered per scenario with `stubKratosIdentity`
 *
 * Stripe is mocked per-scenario via billing.steps.ts.
 */

import nock from 'nock';

import { buildHydraJwks, buildInternalJwks } from './jwt.helper';

const HYDRA_BASE = 'http://localhost:4444';
const INTERNAL_JWKS_BASE = 'http://localhost:5002';
const KETO_READ_BASE = 'http://localhost:4466';
const KRATOS_ADMIN_BASE = 'http://localhost:4434';
const KETO_CHECK_PATH = '/relation-tuples/check/openapi';

let jwksScope: nock.Scope;
let ketoScope: nock.Scope;

/**
 * Register all persistent nock interceptors.
 * Call once from BeforeAll.
 */
export function setupNock(): void {
    // Allow outgoing connections nock doesn't intercept (e.g. Prisma TCP, Redis), but BLOCK Stripe and the
    // Ory ports so an unmocked call fails fast instead of reaching a real service.
    nock.enableNetConnect(/^(?!localhost:4444|localhost:4466|localhost:4434|localhost:5002|api\.stripe\.com).*$/);

    // ── JWKS (persisted — jwks-rsa fetches on every token when the cache is off) ──
    jwksScope = nock(HYDRA_BASE).persist().get('/.well-known/jwks.json').reply(200, buildHydraJwks());
    nock(INTERNAL_JWKS_BASE).persist().get('/.well-known/jwks.json').reply(200, buildInternalJwks());

    // ── Keto permission check (allow everything by default) ──
    ketoScope = nock(KETO_READ_BASE).persist().post(KETO_CHECK_PATH).reply(200, { allowed: true });
}

/**
 * Remove all interceptors. Call from AfterAll.
 */
export function teardownNock(): void {
    nock.cleanAll();
    nock.enableNetConnect();
}

/**
 * Temporarily override Keto to deny permission for a single request.
 * nock uses the most recently registered matching interceptor first.
 */
export function denyNextKetoCheck(): void {
    nock(KETO_READ_BASE).post(KETO_CHECK_PATH).once().reply(200, { allowed: false });
}

/** Make Kratos (the credential authority) know an identity with this email. */
export function stubKratosIdentity(identityId: string, email: string): void {
    nock(KRATOS_ADMIN_BASE)
        .persist()
        .get(`/admin/identities/${identityId}`)
        .reply(200, { id: identityId, schema_id: 'default', traits: { email } });
}

export { jwksScope, ketoScope };
