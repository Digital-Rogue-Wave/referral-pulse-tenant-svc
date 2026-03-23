import { BadRequestException, Injectable } from '@nestjs/common';

import type { Plan } from '@prisma-gen/generated/client';
import { Prisma } from '@prisma-gen/generated/client';
import type { NullableType } from '@app/types';
import type { PaginateQuery, Paginated } from '@common/nestjs-prisma-pagination';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { prismaPaginate } from '@common/nestjs-prisma-pagination';

import { CreatePlanDto, UpdatePlanDto } from '@domains/billing';
import { assertValidPlanLimits } from './plan-limits.type';
import type { PlanLimits } from './plan-limits.type';
import { PLAN_PAGINATE_CONFIG } from './plan.pagination';

@Injectable()
export class PlanService {
    private readonly publicPlansCacheTtlSec = 3600; // ~1 hour

    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly redisService: RedisService,
        private readonly keyBuilder: RedisKeyBuilder,
    ) {
        this.logger.setContext(PlanService.name);
    }

    private buildPublicPlansCacheKey(): string {
        return this.keyBuilder.buildGlobalKey('billing-plans', 'public');
    }

    private validateLimitsOrThrow(limits: PlanLimits | null | undefined): void {
        try {
            assertValidPlanLimits(limits ?? null);
        } catch (error) {
            const message = (error as Error).message || 'Invalid plan limits';
            throw new BadRequestException(message);
        }
    }

    public async invalidateCaches(): Promise<void> {
        const publicKey = this.buildPublicPlansCacheKey();
        try {
            await this.redisService.del(publicKey, false);
        } catch (error) {
            this.logger.warn(`Failed to invalidate plan cache for key ${publicKey}: ${(error as Error).message}`);
        }
    }

    async create(dto: CreatePlanDto): Promise<Plan> {
        if (dto.manualInvoicing && !dto.tenantId) {
            throw new BadRequestException('manualInvoicing plans must be associated with a tenantId');
        }

        this.validateLimitsOrThrow(dto.limits ?? null);

        const plan = await this.prisma.plan.create({
            data: {
                name: dto.name,
                stripePriceId: dto.stripePriceId ?? null,
                stripeProductId: dto.stripeProductId ?? null,
                interval: dto.interval ?? null,
                limits: dto.limits ?? Prisma.JsonNull,
                tenantId: dto.tenantId ?? null,
                isActive: dto.isActive ?? true,
                manualInvoicing: dto.manualInvoicing ?? false,
                metadata: dto.metadata ?? Prisma.JsonNull,
            },
        });

        await this.invalidateCaches();
        return plan;
    }

    async findAllPaginated(query: PaginateQuery<Plan>, includeInactive = false): Promise<Paginated<Plan>> {
        const baseWhere: Prisma.PlanWhereInput = {
            deletedAt: null,
        };

        if (!includeInactive) {
            baseWhere.isActive = true;
        }

        return prismaPaginate(query, this.prisma.plan, PLAN_PAGINATE_CONFIG, baseWhere);
    }

    async findOne(where: Prisma.PlanWhereInput): Promise<NullableType<Plan>> {
        return this.prisma.plan.findFirst({
            where: { ...where, deletedAt: null },
        });
    }

    async findOneOrFail(where: Prisma.PlanWhereInput): Promise<Plan> {
        const plan = await this.prisma.plan.findFirst({
            where: { ...where, deletedAt: null },
        });

        if (!plan) {
            throw new BadRequestException('Plan not found');
        }

        return plan;
    }

    async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
        const existingPlan = await this.findOneOrFail({ id });

        const updateData: Prisma.PlanUpdateInput = {};

        if (dto.name !== undefined) {
            updateData.name = dto.name;
        }

        if (dto.stripePriceId !== undefined) {
            updateData.stripePriceId = dto.stripePriceId ?? null;
        }

        if (dto.stripeProductId !== undefined) {
            updateData.stripeProductId = dto.stripeProductId ?? null;
        }

        if (dto.interval !== undefined) {
            updateData.interval = dto.interval ?? null;
        }

        if (dto.limits !== undefined) {
            this.validateLimitsOrThrow(dto.limits ?? null);
            updateData.limits = dto.limits ?? Prisma.JsonNull;
        }

        if (dto.tenantId !== undefined) {
            updateData.tenantId = dto.tenantId ?? null;
        }

        if (dto.isActive !== undefined) {
            updateData.isActive = dto.isActive;
        }

        if (dto.manualInvoicing !== undefined) {
            updateData.manualInvoicing = dto.manualInvoicing;
        }

        // Check manualInvoicing constraint with merged values
        const finalManualInvoicing =
            dto.manualInvoicing !== undefined ? dto.manualInvoicing : existingPlan.manualInvoicing;
        const finalTenantId = dto.tenantId !== undefined ? dto.tenantId : existingPlan.tenantId;

        if (finalManualInvoicing && !finalTenantId) {
            throw new BadRequestException('manualInvoicing plans must be associated with a tenantId');
        }

        if (dto.metadata !== undefined) {
            updateData.metadata = dto.metadata ?? Prisma.JsonNull;
        }

        const updated = await this.prisma.plan.update({
            where: { id },
            data: updateData,
        });

        await this.invalidateCaches();
        return updated;
    }

    async softDelete(id: string): Promise<void> {
        await this.findOneOrFail({ id });

        await this.prisma.plan.update({
            where: { id },
            data: { isActive: false },
        });

        await this.invalidateCaches();
    }

    async getPublicPlansCached(): Promise<Plan[]> {
        const cacheKey = this.buildPublicPlansCacheKey();

        const cached = await this.redisService.get<Plan[]>(cacheKey, {
            tenantScoped: false,
        });
        if (cached) {
            return cached;
        }

        const plans = await this.prisma.plan.findMany({
            where: {
                tenantId: null,
                isActive: true,
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        await this.redisService.set(cacheKey, plans, {
            ttl: this.publicPlansCacheTtlSec,
            tenantScoped: false,
        });
        return plans;
    }
}
