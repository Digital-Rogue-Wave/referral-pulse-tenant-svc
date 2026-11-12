import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantDeletedEvent, TenantEvents } from '@domains/tenant/events/tenant.events';
import { UserRemovedEvent, UserRoleChangedEvent } from '@domains/user';

import { CredentialResolverService } from './credential-resolver.service';

/**
 * A removed member, or one whose role changed, must not keep the tenant and `perms` of a cached exchange (API §2:
 * revoked permissions deny on the next token refresh). Dropping their cached exchanges makes the next request resolve
 * them again; a failure is logged and the cache still expires with the internal JWT it holds.
 */
@Injectable()
export class ExchangeCacheListener {
    constructor(
        private readonly credentials: CredentialResolverService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(ExchangeCacheListener.name);
    }

    @OnEvent('user.removed', { async: true })
    async onUserRemoved(event: UserRemovedEvent): Promise<void> {
        await this.forget(event.aggregateId, 'user.removed');
    }

    @OnEvent('user.role_changed', { async: true })
    async onUserRoleChanged(event: UserRoleChangedEvent): Promise<void> {
        await this.forget(event.aggregateId, 'user.role_changed');
    }

    @OnEvent(TenantEvents.DELETED, { async: true })
    async onTenantDeleted(event: TenantDeletedEvent): Promise<void> {
        await this.drop(() => this.credentials.forgetTenant(event.tenantId), { tenantId: event.tenantId, reason: TenantEvents.DELETED });
    }

    private async forget(userId: string, reason: string): Promise<void> {
        await this.drop(() => this.credentials.forgetUser(userId), { userId, reason });
    }

    private async drop(forget: () => Promise<number>, context: Record<string, string>): Promise<void> {
        try {
            const dropped = await forget();
            this.logger.log('Dropped cached credential exchanges', { ...context, dropped });
        } catch (error) {
            this.logger.error(
                'Could not drop cached credential exchanges; they expire with their token',
                error instanceof Error ? error.stack : undefined,
                context
            );
        }
    }
}
