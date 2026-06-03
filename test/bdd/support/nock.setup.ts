/**
 * nock Interceptors for BDD Tests
 *
 * All external HTTP dependencies are mocked here:
 *  - JWKS endpoint  (Ory Hydra) — serves the test RSA public key
 *  - Keto read API  — returns { allowed: true } for all permission checks
 *
 * Stripe is mocked per-scenario via billing.steps.ts.
 */

import nock from 'nock';
import { buildJwks } from './jwt.helper';

const HYDRA_BASE = 'http://localhost:4444';
const KETO_READ_BASE = 'http://localhost:4466';

let jwksScope: nock.Scope;
let ketoScope: nock.Scope;

/**
 * Register all persistent nock interceptors.
 * Call once from BeforeAll.
 */
export function setupNock(): void {
    // Allow outgoing connections that nock doesn't intercept (e.g. Prisma TCP)
    nock.enableNetConnect(/^(?!localhost:4444|localhost:4466).*$/);

    // ── JWKS (must be .persist() — jwks-rsa fetches on every token when cache=false) ──
    jwksScope = nock(HYDRA_BASE)
        .persist()
        .get('/.well-known/jwks.json')
        .reply(200, buildJwks());

    // ── Keto permission check (allow everything by default) ──
    ketoScope = nock(KETO_READ_BASE)
        .persist()
        .post('/relation-tuples/check')
        .reply(200, { allowed: true });
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
 * Registers a one-shot interceptor that overrides the persistent allow.
 * nock uses the most recently registered matching interceptor first.
 */
export function denyNextKetoCheck(): void {
    nock(KETO_READ_BASE)
        .post('/relation-tuples/check')
        .once()
        .reply(200, { allowed: false });
}

export { jwksScope, ketoScope };
