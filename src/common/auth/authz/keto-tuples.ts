import { RoleEnum } from '@common/enums/role.enum';

import type { KetoRelationTuple } from '../keto.service';
import { Permission, ROLE_GRANTS, splitPermission } from './permission-catalog';

/**
 * Keto tuple shapes (API Contract §2 "Relation Tuple Examples").
 *
 *   membership   role:{tenant_id}:{role}#member@user:{user_id}
 *   grant        campaigns:{tenant_id}#write@(role:{tenant_id}:operator#member)
 *   platform     platform:referralai#admin@user:{user_id}
 *   service      services:{capability}#call@service:{client_id}
 *
 * Role objects are tenant-scoped. The spec's `role:operator#member` example is not, which would let an
 * operator of one tenant satisfy another tenant's grant; that is recorded as a decision in NOTE.md.
 */
export const KETO_ROLE_NAMESPACE = 'role';
export const KETO_MEMBER_RELATION = 'member';
export const KETO_PLATFORM_NAMESPACE = 'platform';
export const KETO_PLATFORM_OBJECT = 'referralai';
export const KETO_PLATFORM_ADMIN_RELATION = 'admin';
export const KETO_SERVICES_NAMESPACE = 'services';
export const KETO_SERVICE_CALL_RELATION = 'call';

/** The Keto reconciler's queue and its jobs: the nightly full run, and one tenant's run after its role changes. */
export const KETO_RECONCILER_QUEUE = 'keto-reconciler';
export const RECONCILE_ALL_JOB = 'reconcile-keto';
export const RECONCILE_TENANT_JOB = 'reconcile-tenant';
/** A tenant is reconciled this long after its last role change (debounced, E1 decision D7, US1.3.1 F3). */
export const RECONCILE_TENANT_DELAY_MS = 2 * 60 * 1000;

/** Capabilities another service (client-credentials token) can be granted on tenant-service's internal API. */
export enum ServiceCapability {
    TENANT_STATUS_READ = 'tenant_status.read',
    TENANT_ENTITLEMENTS_READ = 'tenant_entitlements.read',
    TENANT_CONTACTS_READ = 'tenant_contacts.read',
    TENANT_VERIFICATION_WRITE = 'tenant_verification.write',
    TENANT_SUSPEND = 'tenant.suspend',
    USAGE_WRITE = 'usage.write',
    DSR_ERASE = 'dsr.erase',
    /** Event Ingestion reading a provider connection and its secret to verify a callback (Architecture §2.1/§2.4). */
    PROVIDER_CONNECTION_READ = 'provider_connection.read',
    /** Event Ingestion reporting a connection's first verified callback, which activates it (v5.2 US1.5.2). */
    CONNECTION_STATUS_WRITE = 'connection_status.write',
    /**
     * Reward- and notification-service reading a connection's outbound credential for one provider call
     * (v5.2 API §3.16 `GET /internal/connections/{id}/credential`, audited). Separate from `provider_connection.read`
     * so Event Ingestion never holds an outbound credential (US1.5.4 AC1).
     */
    CONNECTION_CREDENTIAL_READ = 'connection_credential.read',
    /**
     * The email-tracking token key. Notification-service signs `/t/o` and `/t/c` tokens with it and
     * Event Ingestion verifies them, so both hold this capability — separate from
     * `provider_connection.read` so neither service gets the other's secrets by holding one grant.
     */
    TRACKING_TOKEN_READ = 'tracking_token.read',
    /**
     * A tenant's widget-token secret. Event Ingestion verifies the backend-signed widget token with
     * it (API Contract §4.1), and only ingestion needs it — separate from `tracking_token.read` so
     * notification-service does not acquire tenant signing secrets by holding the tracking grant.
     */
    WIDGET_SECRET_READ = 'widget_secret.read',
    /**
     * Exchanging an inbound credential for an internal JWT — `GET /internal/validate-token`.
     *
     * Architecture §13.1 names "the ALB + Traefik + NestJS Auth Guard" as the caller and §12.1 lists
     * "the Tenant token call" among Event Ingestion's own integration adapters, so a service calls this
     * as well as the gateway. The gateway proves itself with `X-Gateway-Secret`; a service proves itself
     * with its own token and this capability, so the gateway's shared secret stays in the gateway and
     * each service caller is individually revocable.
     *
     * Held only by `ingestion-svc`: it is the one service that receives API keys (Product Spec
     * R-SDK-07), and this endpoint can mint an internal JWT for any credential presented to it.
     */
    TOKEN_EXCHANGE_CALL = 'token_exchange.call'
}

export const userSubject = (userId: string): string => `user:${userId}`;
export const serviceSubject = (clientId: string): string => `service:${clientId}`;
export const roleObject = (tenantId: string, role: RoleEnum): string => `${tenantId}:${role.toLowerCase()}`;

export function membershipTuple(tenantId: string, role: RoleEnum, userId: string): KetoRelationTuple {
    return {
        namespace: KETO_ROLE_NAMESPACE,
        object: roleObject(tenantId, role),
        relation: KETO_MEMBER_RELATION,
        subject_id: userSubject(userId)
    };
}

function grantTuple(tenantId: string, role: RoleEnum, permission: Permission): KetoRelationTuple {
    const { namespace, relation } = splitPermission(permission);
    return {
        namespace,
        object: tenantId,
        relation,
        subject_set: { namespace: KETO_ROLE_NAMESPACE, object: roleObject(tenantId, role), relation: KETO_MEMBER_RELATION }
    };
}

/**
 * Narrow service relations written for every tenant (API Contract §2, E1 decision D18): v5.1 §4 grants
 * `payouts:confirm` to `service:payout-worker` ("confirm disburses (also granted to service:payout-worker)").
 * R-AI-02: the AI's autonomous incentive path runs as `service:ai-optimizer` holding only `variants:write`; campaign-svc
 * holds every such write to the campaign's optimisation bounds (R-AI-04).
 * Per tenant, never a wildcard object, so a worker acting for one tenant cannot touch another.
 */
export const SERVICE_GRANTS: Readonly<Record<string, readonly Permission[]>> = {
    'payout-worker': ['payouts:confirm'],
    'ai-optimizer': ['variants:write']
};

function serviceGrantTuple(tenantId: string, clientId: string, permission: Permission): KetoRelationTuple {
    const { namespace, relation } = splitPermission(permission);
    return { namespace, object: tenantId, relation, subject_id: serviceSubject(clientId) };
}

/** Every role→permission grant and service relation for one tenant. Written when the tenant is created (and by the reconciler). */
export function tenantGrantTuples(tenantId: string): KetoRelationTuple[] {
    const roleGrants = (Object.keys(ROLE_GRANTS) as RoleEnum[]).flatMap((role) =>
        ROLE_GRANTS[role].map((permission) => grantTuple(tenantId, role, permission))
    );
    const serviceGrants = Object.entries(SERVICE_GRANTS).flatMap(([clientId, permissions]) =>
        permissions.map((permission) => serviceGrantTuple(tenantId, clientId, permission))
    );
    return [...roleGrants, ...serviceGrants];
}
