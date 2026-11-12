import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { IKetoSideEffectPayload } from '@app/types';

import { KETO_RECONCILER_QUEUE, RECONCILE_TENANT_DELAY_MS, RECONCILE_TENANT_JOB } from '@common/auth/authz/keto-tuples';
import { BullJobsService } from '@common/bulljobs';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { SideEffectService } from '@common/side-effects/side-effect.service';
import { UserDisabledEvent, UserEnabledEvent, UserRegisteredEvent, UserRemovedEvent, UserRoleChangedEvent } from '@domains/user';
import { TenantCreatedEvent, TenantDeletedEvent, TenantEvents } from '@domains/tenant/events/tenant.events';

/**
 * Mirrors membership changes into Ory Keto (API Contract §2), through the outbox so a Keto outage
 * delays permissions instead of losing them. Every operation is idempotent; the daily Keto reconciler
 * rewrites the full state from `users`, which also covers a crash between commit and this listener.
 */
@Injectable()
export class KetoSyncListener {
    constructor(
        private readonly sideEffects: SideEffectService,
        private readonly bullJobs: BullJobsService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(KetoSyncListener.name);
    }

    @OnEvent(TenantEvents.CREATED, { async: true })
    async onTenantCreated(event: TenantCreatedEvent): Promise<void> {
        await this.sync({ operation: 'grant_tenant', tenantId: event.tenantId });
    }

    @OnEvent(TenantEvents.DELETED, { async: true })
    async onTenantDeleted(event: TenantDeletedEvent): Promise<void> {
        await this.sync({ operation: 'revoke_tenant', tenantId: event.tenantId });
    }

    @OnEvent('user.registered', { async: true })
    async onUserRegistered(event: UserRegisteredEvent): Promise<void> {
        await this.sync({ operation: 'assign_role', tenantId: event.tenantId, userId: event.aggregateId, role: event.role });
    }

    @OnEvent('user.role_changed', { async: true })
    async onUserRoleChanged(event: UserRoleChangedEvent): Promise<void> {
        await this.sync({ operation: 'assign_role', tenantId: event.tenantId, userId: event.aggregateId, role: event.newRole });
    }

    @OnEvent('user.removed', { async: true })
    async onUserRemoved(event: UserRemovedEvent): Promise<void> {
        await this.sync({ operation: 'remove_member', tenantId: event.tenantId, userId: event.aggregateId });
    }

    @OnEvent('user.disabled', { async: true })
    async onUserDisabled(event: UserDisabledEvent): Promise<void> {
        await this.sync({ operation: 'remove_member', tenantId: event.tenantId, userId: event.aggregateId });
    }

    /** `assign_role` re-reads `users`, so an enable racing a later disable still converges on the stored state. */
    @OnEvent('user.enabled', { async: true })
    async onUserEnabled(event: UserEnabledEvent): Promise<void> {
        await this.sync({ operation: 'assign_role', tenantId: event.tenantId, userId: event.aggregateId, role: event.role });
    }

    private async sync(payload: IKetoSideEffectPayload): Promise<void> {
        try {
            await this.sideEffects.createKetoSideEffect(payload);
            if (payload.userId) {
                await this.scheduleTenantReconcile(payload.tenantId);
            }
        } catch (error) {
            // The reconciler restores the state; this is logged so the gap is visible until then.
            this.logger.error('Could not queue Keto sync — the reconciler will repair it', error instanceof Error ? error.stack : undefined, {
                operation: payload.operation,
                tenantId: payload.tenantId,
                userId: payload.userId
            });
        }
    }

    /**
     * One reconcile of the tenant two minutes after its last membership change (E1 decision D7, US1.3.1 F3):
     * a burst of changes resets the delay instead of queuing a run per change, and the run repairs any drift
     * the ordered effects left. Best effort: the nightly run covers a failure to schedule.
     */
    private async scheduleTenantReconcile(tenantId: string): Promise<void> {
        await this.bullJobs
            .addJob(
                KETO_RECONCILER_QUEUE,
                RECONCILE_TENANT_JOB,
                { tenantId },
                {
                    delay: RECONCILE_TENANT_DELAY_MS,
                    deduplication: { id: `reconcile-tenant:${tenantId}`, ttl: RECONCILE_TENANT_DELAY_MS, extend: true, replace: true }
                }
            )
            .catch((error: unknown) =>
                this.logger.warn('Could not schedule the tenant Keto reconcile — the nightly run covers it', {
                    tenantId,
                    reason: error instanceof Error ? error.message : 'unknown'
                })
            );
    }
}
