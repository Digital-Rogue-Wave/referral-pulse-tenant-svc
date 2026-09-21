import { RoleEnum } from '@common/enums/role.enum';

import type { KetoRelationTuple } from '../keto.service';
import { Permission, ROLE_GRANTS, splitPermission } from './permission-catalog';

/**
 * Keto tuple shapes (API Contract v1.3 §2 "Relation Tuple Examples").
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

/** Capabilities another service (client-credentials token) can be granted on tenant-service's internal API. */
export enum ServiceCapability {
    TENANT_STATUS_READ = 'tenant_status.read',
    TENANT_ENTITLEMENTS_READ = 'tenant_entitlements.read',
    TENANT_CONTACTS_READ = 'tenant_contacts.read',
    TENANT_VERIFICATION_WRITE = 'tenant_verification.write',
    TENANT_SUSPEND = 'tenant.suspend',
    USAGE_WRITE = 'usage.write'
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

/** Every role→permission grant for one tenant. Written once when the tenant is created (and by the reconciler). */
export function tenantGrantTuples(tenantId: string): KetoRelationTuple[] {
    return (Object.keys(ROLE_GRANTS) as RoleEnum[]).flatMap((role) => ROLE_GRANTS[role].map((permission) => grantTuple(tenantId, role, permission)));
}
