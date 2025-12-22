import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { Paginated, PaginateQuery, paginate } from 'nestjs-paginate';

import { PlanEntity } from './plan.entity';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { planPaginationConfig } from './config/plan-pagination.config';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisKeyBuilder } from '@mod/common/aws-redis/redis-key.builder';
import { assertValidPlanLimits } from './plan-limits.type';
import type { PlanLimits } from './plan-limits.type';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class PlanService {
    private readonly logger = new Logger(PlanService.name);
    private readonly publicPlansCacheTtlSec = 3600; // ~1 hour

    constructor(
        @InjectRepository(PlanEntity)
        private readonly planRepository: Repository<PlanEntity>,
        private readonly redisService: RedisService,
        private readonly keyBuilder: RedisKeyBuilder
    ) {}

    private buildPublicPlansCacheKey(): string {
        return this.keyBuilder.build('billing', 'plans', 'public');
    }

    private validateLimitsOrThrow(limits: PlanLimits | null | undefined): void {
        try {
            assertValidPlanLimits(limits ?? null);
        } catch (error) {
            const message = (error as Error).message || 'Invalid plan limits';
            throw new BadRequestException(message);
        }
    }

    private async invalidateCaches(): Promise<void> {
        const publicKey = this.buildPublicPlansCacheKey();
        try {
            await this.redisService.del(publicKey);
        } catch (error) {
            this.logger.warn(`Failed to invalidate plan cache for key ${publicKey}: ${(error as Error).message}`);
        }
    }

    async create(dto: CreatePlanDto): Promise<PlanEntity> {
        if (dto.manualInvoicing && !dto.tenantId) {
            throw new BadRequestException('manualInvoicing plans must be associated with a tenantId');
        }

        this.validateLimitsOrThrow(dto.limits ?? null);

        const plan = this.planRepository.create({
            name: dto.name,
            stripePriceId: dto.stripePriceId ?? null,
            stripeProductId: dto.stripeProductId ?? null,
            interval: dto.interval ?? null,
            limits: dto.limits ?? null,
            tenantId: dto.tenantId ?? null,
            isActive: dto.isActive ?? true,
            manualInvoicing: dto.manualInvoicing ?? false,
            metadata: dto.metadata ?? null
        });

        const saved = await this.planRepository.save(plan);
        await this.invalidateCaches();
        return saved;
    }

    async findAllPaginated(query: PaginateQuery, includeInactive = false): Promise<Paginated<PlanEntity>> {
        const where = includeInactive ? undefined : ({ isActive: true } as FindOptionsWhere<PlanEntity>);

        return paginate<PlanEntity>(query, this.planRepository, {
            ...planPaginationConfig,
            where
        });
    }

    async findOne(where: FindOptionsWhere<PlanEntity>): Promise<NullableType<PlanEntity>> {
        return this.planRepository.findOne({ where });
    }

    async findOneOrFail(where: FindOptionsWhere<PlanEntity>): Promise<PlanEntity> {
        return this.planRepository.findOneOrFail({ where });
    }

    async update(id: string, dto: UpdatePlanDto): Promise<PlanEntity> {
        const plan = await this.findOneOrFail({ id });

        if (dto.name !== undefined) {
            plan.name = dto.name;
        }

        if (dto.stripePriceId !== undefined) {
            plan.stripePriceId = dto.stripePriceId ?? null;
        }

        if (dto.stripeProductId !== undefined) {
            plan.stripeProductId = dto.stripeProductId ?? null;
        }

        if (dto.interval !== undefined) {
            plan.interval = dto.interval ?? null;
        }

        if (dto.limits !== undefined) {
            this.validateLimitsOrThrow(dto.limits ?? null);
            plan.limits = dto.limits ?? null;
        }

        if (dto.tenantId !== undefined) {
            plan.tenantId = dto.tenantId ?? null;
        }

        if (dto.isActive !== undefined) {
            plan.isActive = dto.isActive;
        }

        if (dto.manualInvoicing !== undefined) {
            plan.manualInvoicing = dto.manualInvoicing;
        }

        if (plan.manualInvoicing && !plan.tenantId) {
            throw new BadRequestException('manualInvoicing plans must be associated with a tenantId');
        }

        if (dto.metadata !== undefined) {
            plan.metadata = dto.metadata ?? null;
        }

        const saved = await this.planRepository.save(plan);
        await this.invalidateCaches();
        return saved;
    }

    async softDelete(id: string): Promise<void> {
        const plan = await this.findOneOrFail({ id });
        plan.isActive = false;
        await this.planRepository.save(plan);
        await this.invalidateCaches();
    }

    async getPublicPlansCached(): Promise<PlanEntity[]> {
        const cacheKey = this.buildPublicPlansCacheKey();

        const cached = (await this.redisService.getJson<any>(cacheKey)) as PlanEntity[] | null;
        if (cached) {
            return cached;
        }

        const plans = await this.planRepository.find({
            where: {
                tenantId: IsNull(),
                isActive: true
            },
            order: {
                createdAt: 'ASC'
            }
        });

        await this.redisService.setJson(cacheKey, plans as any, this.publicPlansCacheTtlSec);
        return plans;
    }
}
