import { Injectable, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { prismaPaginate, PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';

import {
    TenantSettingProps,
    CreateTenantSettingDto,
    UpdateTenantSettingDto,
    TenantSettingResponse,
    tenantSettingResponseMapper,
    TenantSettingCreatedEvent,
    TenantSettingUpdatedEvent,
    TenantSettingDeletedEvent
} from '@domains/tenant-setting';

import { TENANT_SETTING_PAGINATE_CONFIG } from './tenant-setting.pagination';

/**
 * Service responsible for Tenant Setting management
 * Uses Prisma with TenantAwareService for multi-tenant data access
 */
@Injectable()
export class TenantSettingService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantAware: TenantAwareService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TenantSettingService.name);
    }

    /** Tenant-scoped TenantSetting delegate */
    private get tenantSetting() {
        return this.tenantAware.forModel(this.prisma.tenantSetting);
    }

    /**
     * Create tenant settings
     */
    async create(dto: CreateTenantSettingDto): Promise<TenantSettingResponse> {
        const userId = this.tenantContext.getUserId();

        const saved = (await this.tenantSetting.create({
            data: {
                branding: dto.branding || {},
                notifications: dto.notifications || {},
                general: dto.general || {},
                currencyCode: dto.currencyCode
            }
        })) as TenantSettingProps;

        const event = new TenantSettingCreatedEvent(
            saved.id,
            saved.tenantId,
            {
                settingId: saved.id,
                tenantId: saved.tenantId,
                currencyCode: saved.currencyCode,
                createdAt: saved.createdAt
            },
            userId
        );
        this.txEventEmitter.emitAfterCommit('tenant-setting.created', event);
        this.txEventEmitter.emitAfterCommit('audit.tenant-setting.created', event);

        this.logger.log(`Tenant setting created: ${saved.id}`, {
            settingId: saved.id,
            tenantId: saved.tenantId
        });

        return tenantSettingResponseMapper.toResponse(saved);
    }

    /**
     * List all tenant settings with pagination
     */
    async findAll(query: PaginateQuery): Promise<Paginated<TenantSettingResponse>> {
        const baseWhere = this.tenantAware.withTenantFilter({ deletedAt: null });
        const result = await prismaPaginate(query, this.prisma.tenantSetting, TENANT_SETTING_PAGINATE_CONFIG, baseWhere);

        return {
            data: tenantSettingResponseMapper.toResponseArray(result.data as TenantSettingProps[]),
            meta: result.meta as Paginated<TenantSettingResponse>['meta'],
            links: result.links
        };
    }

    /**
     * Get tenant setting by ID
     */
    async findById(id: string): Promise<TenantSettingResponse> {
        const setting = (await this.tenantSetting.findUnique({
            where: { id }
        })) as TenantSettingProps | null;

        if (!setting) {
            throw new NotFoundException(`Tenant setting with ID ${id} not found`);
        }

        return tenantSettingResponseMapper.toResponse(setting);
    }

    /**
     * Get tenant setting for current tenant
     */
    async findByTenant(): Promise<TenantSettingResponse | null> {
        const tenantId = this.tenantContext.getTenantId();

        const setting = (await this.prisma.tenantSetting.findUnique({
            where: { tenantId }
        })) as TenantSettingProps | null;

        if (!setting) {
            return null;
        }

        return tenantSettingResponseMapper.toResponse(setting);
    }

    /**
     * Update tenant settings
     */
    async update(id: string, dto: UpdateTenantSettingDto): Promise<TenantSettingResponse> {
        const userId = this.tenantContext.getUserId();

        const existing = (await this.tenantSetting.findUnique({
            where: { id }
        })) as TenantSettingProps | null;

        if (!existing) {
            throw new NotFoundException(`Tenant setting with ID ${id} not found`);
        }

        const updateData: Record<string, unknown> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};

        if (dto.branding !== undefined) {
            updateData.branding = dto.branding;
            changes.branding = { from: existing.branding, to: dto.branding };
        }
        if (dto.notifications !== undefined) {
            updateData.notifications = dto.notifications;
            changes.notifications = {
                from: existing.notifications,
                to: dto.notifications
            };
        }
        if (dto.general !== undefined) {
            updateData.general = dto.general;
            changes.general = { from: existing.general, to: dto.general };
        }
        if (dto.currencyCode !== undefined) {
            updateData.currencyCode = dto.currencyCode;
            changes.currencyCode = {
                from: existing.currencyCode,
                to: dto.currencyCode
            };
        }

        const updated = (await this.tenantSetting.update({
            where: { id },
            data: updateData
        })) as TenantSettingProps;

        if (Object.keys(changes).length > 0) {
            const event = new TenantSettingUpdatedEvent(
                id,
                updated.tenantId,
                {
                    settingId: id,
                    tenantId: updated.tenantId,
                    changes,
                    updatedAt: updated.updatedAt
                },
                userId
            );
            this.txEventEmitter.emitAfterCommit('tenant-setting.updated', event);
            this.txEventEmitter.emitAfterCommit('audit.tenant-setting.updated', event);
        }

        this.logger.log(`Tenant setting updated: ${id}`, {
            settingId: id,
            changes
        });

        return tenantSettingResponseMapper.toResponse(updated);
    }

    /**
     * Delete tenant settings
     */
    async delete(id: string): Promise<void> {
        const userId = this.tenantContext.getUserId();

        const existing = (await this.tenantSetting.findUnique({
            where: { id }
        })) as TenantSettingProps | null;

        if (!existing) {
            throw new NotFoundException(`Tenant setting with ID ${id} not found`);
        }

        await this.tenantSetting.delete({ where: { id } });

        const event = new TenantSettingDeletedEvent(
            id,
            existing.tenantId,
            {
                settingId: id,
                tenantId: existing.tenantId,
                deletedAt: new Date()
            },
            userId
        );
        this.txEventEmitter.emitAfterCommit('tenant-setting.deleted', event);
        this.txEventEmitter.emitAfterCommit('audit.tenant-setting.deleted', event);

        this.logger.log(`Tenant setting deleted: ${id}`, { settingId: id });
    }
}
