import { Injectable, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import {
    UserNotificationPreferenceProps,
    UpdateUserNotificationPreferenceDto,
    UserNotificationPreferenceResponse,
    userNotificationPreferenceResponseMapper,
    UserNotificationPreferenceUpdatedEvent,
    NotificationOverrides,
} from '@domains/tenant-setting';

/**
 * Service responsible for User Notification Preference management
 */
@Injectable()
export class UserNotificationPreferenceService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(UserNotificationPreferenceService.name);
    }

    /** Tenant-scoped UserNotificationPreference delegate */
    private get userNotificationPreference() {
        return this.tenantAware.forModel(this.prisma.userNotificationPreference);
    }

    /**
     * Get current user's notification preferences
     */
    async findMyPreferences(): Promise<UserNotificationPreferenceResponse | null> {
        const userId = this.tenantContext.getUserId();
        const tenantId = this.tenantContext.getTenantId();

        if (!userId || !tenantId) {
            return null;
        }

        const preference = (await this.prisma.userNotificationPreference.findUnique({
            where: {
                userId_tenantId: { userId, tenantId },
            },
        })) as UserNotificationPreferenceProps | null;

        if (!preference) {
            return null;
        }

        return userNotificationPreferenceResponseMapper.toResponse(preference);
    }

    /**
     * Update current user's notification preferences (upsert)
     */
    async updateMyPreferences(dto: UpdateUserNotificationPreferenceDto): Promise<UserNotificationPreferenceResponse> {
        const userId = this.tenantContext.getUserId();
        const tenantId = this.tenantContext.getTenantId();

        if (!userId || !tenantId) {
            throw new NotFoundException('User or tenant context not found');
        }

        const overrides: NotificationOverrides = {
            emailEnabled: dto.emailEnabled,
            smsEnabled: dto.smsEnabled,
            pushEnabled: dto.pushEnabled,
        };

        const saved = (await this.prisma.userNotificationPreference.upsert({
            where: {
                userId_tenantId: { userId, tenantId },
            },
            create: {
                userId,
                tenantId,
                overrides,
            },
            update: {
                overrides,
            },
        })) as UserNotificationPreferenceProps;

        this.txEventEmitter.emitAfterCommit(
            'notification.updated',
            new UserNotificationPreferenceUpdatedEvent(
                saved.id,
                tenantId,
                {
                    preferenceId: saved.id,
                    userId,
                    tenantId,
                    overrides,
                    updatedAt: saved.updatedAt,
                },
                userId,
            ),
        );

        this.logger.log(`User notification preference updated: ${saved.id}`, {
            preferenceId: saved.id,
            userId,
        });

        return userNotificationPreferenceResponseMapper.toResponse(saved);
    }

    /**
     * Delete current user's notification preferences
     */
    async deleteMyPreferences(): Promise<void> {
        const userId = this.tenantContext.getUserId();
        const tenantId = this.tenantContext.getTenantId();

        if (!userId || !tenantId) {
            throw new NotFoundException('User or tenant context not found');
        }

        const existing = await this.prisma.userNotificationPreference.findUnique({
            where: {
                userId_tenantId: { userId, tenantId },
            },
        });

        if (!existing) {
            throw new NotFoundException('User notification preference not found');
        }

        await this.prisma.userNotificationPreference.delete({
            where: {
                userId_tenantId: { userId, tenantId },
            },
        });

        this.logger.log(`User notification preference deleted`, {
            userId,
            tenantId,
        });
    }
}
