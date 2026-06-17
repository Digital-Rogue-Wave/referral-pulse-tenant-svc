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

import { CreatePlanDto, UpdatePlanDto, PlanDto, planResponseMapper } from '@domains/billing';
import { assertValidPlanLimits } from './plan-limits.type';
import type { PlanLimits } from './plan-limits.type';
import { PLAN_PAGINATE_CONFIG } from './plan.pagination';

@Injectable()
export class PlanService {
    private readonly publicPlansCacheTtlSec = 3600;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly redisService: RedisService,
        private readonly keyBuilder: RedisKeyBuilder
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

    async create(dto: CreatePlanDto): Promise<PlanDto> {
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
                limits: (dto.limits as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                tenantId: dto.tenantId ?? null,
                isActive: dto.isActive ?? true,
                manualInvoicing: dto.manualInvoicing ?? false,
                metadata: (dto.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull
            }
        });

        await this.invalidateCaches();
        return planResponseMapper.toResponse(plan);
    }

    async findAllPaginated(query: PaginateQuery<PlanDto>, includeInactive = false): Promise<Paginated<PlanDto>> {
        const baseWhere: Prisma.PlanWhereInput = {
            deletedAt: null
        };

        if (!includeInactive) {
            baseWhere.isActive = true;
        }

        const result = await prismaPaginate(query as PaginateQuery<Plan>, this.prisma.plan, PLAN_PAGINATE_CONFIG, baseWhere);
        return {
            ...result,
            data: planResponseMapper.toResponseArray(result.data)
        } as unknown as Paginated<PlanDto>;
    }

    async findOne(where: Prisma.PlanWhereInput): Promise<NullableType<PlanDto>> {
        const plan = await this.prisma.plan.findFirst({
            where: { ...where, deletedAt: null }
        });
        return plan ? planResponseMapper.toResponse(plan) : null;
    }

    async findOneOrFail(where: Prisma.PlanWhereInput): Promise<Plan> {
        const plan = await this.prisma.plan.findFirst({
            where: { ...where, deletedAt: null }
        });

        if (!plan) {
            throw new BadRequestException('Plan not found');
        }

        return plan;
    }

    async update(id: string, dto: UpdatePlanDto): Promise<PlanDto> {
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
            updateData.limits = (dto.limits as Prisma.InputJsonValue) ?? Prisma.JsonNull;
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

        const finalManualInvoicing = dto.manualInvoicing !== undefined ? dto.manualInvoicing : existingPlan.manualInvoicing;
        const finalTenantId = dto.tenantId !== undefined ? dto.tenantId : existingPlan.tenantId;

        if (finalManualInvoicing && !finalTenantId) {
            throw new BadRequestException('manualInvoicing plans must be associated with a tenantId');
        }

        if (dto.metadata !== undefined) {
            updateData.metadata = (dto.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull;
        }

        const updated = await this.prisma.plan.update({
            where: { id },
            data: updateData
        });

        await this.invalidateCaches();
        return planResponseMapper.toResponse(updated);
    }

    async softDelete(id: string): Promise<void> {
        await this.findOneOrFail({ id });

        await this.prisma.plan.update({
            where: { id },
            data: { isActive: false }
        });

        await this.invalidateCaches();
    }

    async getPublicPlansCached(): Promise<PlanDto[]> {
        const cacheKey = this.buildPublicPlansCacheKey();

        const cached = await this.redisService.get<PlanDto[]>(cacheKey, {
            tenantScoped: false
        });
        if (cached) {
            return cached;
        }

        const plans = await this.prisma.plan.findMany({
            where: {
                tenantId: null,
                isActive: true,
                deletedAt: null
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        const mapped = planResponseMapper.toResponseArray(plans);

        await this.redisService.set(cacheKey, mapped, {
            ttl: this.publicPlansCacheTtlSec,
            tenantScoped: false
        });
        return mapped;
    }
}
