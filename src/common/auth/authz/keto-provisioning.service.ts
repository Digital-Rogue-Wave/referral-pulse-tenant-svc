import { Injectable } from '@nestjs/common';

import { RoleEnum } from '@common/enums/role.enum';

import { KetoRelationTuple, KetoService, KetoTuplePatch } from '../keto.service';
import { KETO_MEMBER_RELATION, KETO_ROLE_NAMESPACE, membershipTuple, roleObject, tenantGrantTuples, userSubject } from './keto-tuples';
import { PERMISSION_CATALOG, PermissionNamespace, RETIRED_NAMESPACES } from './permission-catalog';

const ALL_ROLES = Object.values(RoleEnum);

/**
 * Every Keto write tenant-service makes. Each method is idempotent (Keto ignores duplicate inserts and
 * missing deletes), so callers can replay them from the outbox or the reconciler without harm.
 */
@Injectable()
export class KetoProvisioningService {
    constructor(private readonly keto: KetoService) {}

    /**
     * Makes the tenant's role → permission grants exactly the catalogue's: inserts every grant and, in the
     * same atomic batch, deletes any role grant the catalogue no longer holds (a permission taken from a
     * role). Memberships (`role` namespace) and service tuples are not grants and are left alone.
     */
    async grantTenant(tenantId: string): Promise<void> {
        const desired = tenantGrantTuples(tenantId);
        const wanted = new Set(desired.map(tupleKey));
        const existing = await Promise.all(
            (Object.keys(PERMISSION_CATALOG) as PermissionNamespace[]).map((namespace) => this.keto.listTuples({ namespace, object: tenantId }))
        );
        const stale = existing.flat().filter((tuple) => tuple.subject_set && !wanted.has(tupleKey(tuple)));
        await this.keto.patchTuples([
            ...stale.map((tuple): KetoTuplePatch => ({ action: 'delete', relation_tuple: tuple })),
            ...desired.map((tuple): KetoTuplePatch => ({ action: 'insert', relation_tuple: tuple }))
        ]);
    }

    /**
     * Deletes every tuple of the namespaces v5.1 retired, for all tenants at once (one Keto call each).
     * A namespace already removed from Keto's configuration has no reachable tuples left, so its error is
     * skipped rather than failing the re-provisioning.
     */
    async retireNamespaces(): Promise<void> {
        for (const namespace of RETIRED_NAMESPACES) {
            await this.keto.deleteTuples({ namespace }).catch(() => undefined);
        }
    }

    /** Makes `role` the user's only role in the tenant. */
    async assignRole(tenantId: string, userId: string, role: RoleEnum): Promise<void> {
        const patches: KetoTuplePatch[] = ALL_ROLES.filter((other) => other !== role).map((other) => ({
            action: 'delete',
            relation_tuple: membershipTuple(tenantId, other, userId)
        }));
        patches.push({ action: 'insert', relation_tuple: membershipTuple(tenantId, role, userId) });
        await this.keto.patchTuples(patches);
    }

    async removeMember(tenantId: string, userId: string): Promise<void> {
        await this.keto.patchTuples(ALL_ROLES.map((role) => ({ action: 'delete', relation_tuple: membershipTuple(tenantId, role, userId) })));
    }

    /** Removes every grant and membership of a tenant — on deletion, so nothing can authorize against it again. */
    async revokeTenant(tenantId: string): Promise<void> {
        for (const namespace of Object.keys(PERMISSION_CATALOG) as PermissionNamespace[]) {
            await this.keto.deleteTuples({ namespace, object: tenantId });
        }
        for (const role of ALL_ROLES) {
            await this.keto.deleteTuples({ namespace: KETO_ROLE_NAMESPACE, object: roleObject(tenantId, role), relation: KETO_MEMBER_RELATION });
        }
    }

    /** The user's current role memberships in the tenant, straight from Keto (used by the reconciler). */
    async rolesOf(tenantId: string, userId: string): Promise<RoleEnum[]> {
        const memberships = await Promise.all(
            ALL_ROLES.map(async (role) => {
                const tuples = await this.keto.listTuples({
                    namespace: KETO_ROLE_NAMESPACE,
                    object: roleObject(tenantId, role),
                    relation: KETO_MEMBER_RELATION,
                    subject_id: userSubject(userId)
                });
                return tuples.length > 0 ? role : null;
            })
        );
        return memberships.filter((role): role is RoleEnum => role !== null);
    }
}

function tupleKey(tuple: KetoRelationTuple): string {
    const subject = tuple.subject_set ? `${tuple.subject_set.namespace}:${tuple.subject_set.object}#${tuple.subject_set.relation}` : tuple.subject_id;
    return `${tuple.namespace}:${tuple.object}#${tuple.relation}@${subject}`;
}
