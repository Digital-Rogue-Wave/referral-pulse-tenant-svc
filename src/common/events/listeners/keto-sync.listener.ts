import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { IKetoSideEffectPayload } from '@app/types';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { SideEffectService } from '@common/side-effects/side-effect.service';
import { UserRegisteredEvent, UserRemovedEvent, UserRoleChangedEvent } from '@domains/user';
import { TenantCreatedEvent, TenantDeletedEvent, TenantEvents } from '@domains/tenant/events/tenant.events';

/**
 * Mirrors membership changes into Ory Keto (API Contract v1.3 §2), through the outbox so a Keto outage
 * delays permissions instead of losing them. Every operation is idempotent; the daily Keto reconciler
 * rewrites the full state from `users`, which also covers a crash between commit and this listener.
 */
@Injectable()
export class KetoSyncListener {
    constructor(
        private readonly sideEffects: SideEffectService,
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

    private async sync(payload: IKetoSideEffectPayload): Promise<void> {
        try {
            await this.sideEffects.createKetoSideEffect(payload);
        } catch (error) {
            // The reconciler restores the state; this is logged so the gap is visible until then.
            this.logger.error('Could not queue Keto sync — the reconciler will repair it', error instanceof Error ? error.stack : undefined, {
                operation: payload.operation,
                tenantId: payload.tenantId,
                userId: payload.userId
            });
        }
    }
}
