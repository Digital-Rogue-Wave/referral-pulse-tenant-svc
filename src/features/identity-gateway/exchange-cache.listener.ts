import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AppLoggerService } from '@common/logging/app-logger.service';
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

    private async forget(userId: string, reason: string): Promise<void> {
        try {
            const dropped = await this.credentials.forgetUser(userId);
            this.logger.log('Dropped cached credential exchanges', { userId, reason, dropped });
        } catch (error) {
            this.logger.error(
                'Could not drop cached credential exchanges; they expire with their token',
                error instanceof Error ? error.stack : undefined,
                {
                    userId,
                    reason
                }
            );
        }
    }
}
