import { Injectable } from '@nestjs/common';

import type { Prisma } from '@prisma-gen/generated/client';
import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import {
    TenantSettingProps,
    UpdateTenantSettingDto,
    TenantSettingResponse,
    tenantSettingResponseMapper,
    TenantSettingCreatedEvent,
    TenantSettingUpdatedEvent
} from '@domains/tenant-setting';

// Tenant settings: one record per tenant (branding/notifications/general/currency). Read-current + upsert only.
@Injectable()
export class TenantSettingService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TenantSettingService.name);
    }

    /** Current tenant's settings (or null if not yet initialised). */
    async findByTenant(): Promise<TenantSettingResponse | null> {
        const tenantId = this.tenantContext.getTenantId();
        const setting = (await this.prisma.tenantSetting.findUnique({ where: { tenantId } })) as TenantSettingProps | null;
        return setting ? tenantSettingResponseMapper.toResponse(setting) : null;
    }

    /** Create-or-update the current tenant's settings. */
    async upsert(dto: UpdateTenantSettingDto): Promise<TenantSettingResponse> {
        const tenantId = this.tenantContext.getTenantId();
        const userId = this.tenantContext.getUserId();
        const existing = (await this.prisma.tenantSetting.findUnique({ where: { tenantId } })) as TenantSettingProps | null;

        if (!existing) {
            const created = (await this.prisma.tenantSetting.create({
                data: {
                    tenantId: tenantId as string,
                    branding: (dto.branding ?? {}) as Prisma.InputJsonValue,
                    notifications: (dto.notifications ?? {}) as Prisma.InputJsonValue,
                    general: (dto.general ?? {}) as Prisma.InputJsonValue,
                    currencyCode: dto.currencyCode
                }
            })) as TenantSettingProps;

            const event = new TenantSettingCreatedEvent(
                created.id,
                created.tenantId,
                { settingId: created.id, tenantId: created.tenantId, currencyCode: created.currencyCode, createdAt: created.createdAt },
                userId
            );
            this.txEventEmitter.emitAfterCommit('tenant-setting.created', event);
            this.txEventEmitter.emitAfterCommit('audit.tenant-setting.created', event);
            this.logger.log(`Tenant setting created: ${created.id}`, { settingId: created.id, tenantId: created.tenantId });
            return tenantSettingResponseMapper.toResponse(created);
        }

        const { updateData, changes } = this.diff(existing, dto);
        const updated = (await this.prisma.tenantSetting.update({
            where: { tenantId },
            data: updateData as Prisma.TenantSettingUpdateInput
        })) as TenantSettingProps;

        if (Object.keys(changes).length > 0) {
            const event = new TenantSettingUpdatedEvent(
                updated.id,
                updated.tenantId,
                { settingId: updated.id, tenantId: updated.tenantId, changes, updatedAt: updated.updatedAt },
                userId
            );
            this.txEventEmitter.emitAfterCommit('tenant-setting.updated', event);
            this.txEventEmitter.emitAfterCommit('audit.tenant-setting.updated', event);
        }
        this.logger.log(`Tenant setting updated: ${updated.id}`, { settingId: updated.id });
        return tenantSettingResponseMapper.toResponse(updated);
    }

    private diff(existing: TenantSettingProps, dto: UpdateTenantSettingDto) {
        const updateData: Record<string, unknown> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const field of ['branding', 'notifications', 'general', 'currencyCode'] as const) {
            if (dto[field] !== undefined) {
                updateData[field] = dto[field];
                changes[field] = { from: (existing as unknown as Record<string, unknown>)[field], to: dto[field] };
            }
        }
        return { updateData, changes };
    }
}
