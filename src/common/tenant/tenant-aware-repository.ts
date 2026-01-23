import {
    Repository,
    EntityTarget,
    FindOptionsWhere,
    FindManyOptions,
    FindOneOptions,
    DeepPartial,
    SaveOptions,
    ObjectLiteral,
    SelectQueryBuilder,
    DataSource,
} from 'typeorm';
import { Injectable, Inject, Type } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ClsTenantContextService } from './cls-tenant-context.service';

/**
 * Repository that automatically scopes all operations to the current tenant.
 */
@Injectable()
export class TenantAwareRepository<Entity extends ObjectLiteral> {
    private readonly repository: Repository<Entity>;

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly tenantContext: ClsTenantContextService,
        private readonly entityClass: EntityTarget<Entity>,
    ) {
        this.repository = this.dataSource.getRepository(entityClass);
    }

    private getRequiredTenantId(): string {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) {
            throw new Error('Tenant context is required but not available');
        }
        return tenantId;
    }

    private withTenantFilter<T extends FindOptionsWhere<Entity>>(where?: T | T[]): T | T[] {
        const tenantId = this.getRequiredTenantId();
        const tenantFilter = { tenantId } as unknown as T;

        if (!where) return tenantFilter;
        if (Array.isArray(where)) {
            return where.map((w) => ({ ...w, ...tenantFilter }));
        }
        return { ...where, ...tenantFilter };
    }

    async find(options?: FindManyOptions<Entity>): Promise<Entity[]> {
        return this.repository.find({
            ...options,
            where: this.withTenantFilter(options?.where as FindOptionsWhere<Entity>),
        });
    }

    async findOne(options: FindOneOptions<Entity>): Promise<Entity | null> {
        return this.repository.findOne({
            ...options,
            where: this.withTenantFilter(options.where as FindOptionsWhere<Entity>),
        });
    }

    async findOneById(id: string): Promise<Entity | null> {
        return this.repository.findOne({
            where: this.withTenantFilter({ id } as unknown as FindOptionsWhere<Entity>),
        });
    }

    async findOneOrFail(options: FindOneOptions<Entity>): Promise<Entity> {
        return this.repository.findOneOrFail({
            ...options,
            where: this.withTenantFilter(options.where as FindOptionsWhere<Entity>),
        });
    }

    async count(options?: FindManyOptions<Entity>): Promise<number> {
        return this.repository.count({
            ...options,
            where: this.withTenantFilter(options?.where as FindOptionsWhere<Entity>),
        });
    }

    async exists(options: FindManyOptions<Entity>): Promise<boolean> {
        return this.repository.exists({
            ...options,
            where: this.withTenantFilter(options.where as FindOptionsWhere<Entity>),
        });
    }

    async findAndCount(options?: FindManyOptions<Entity>): Promise<[Entity[], number]> {
        return this.repository.findAndCount({
            ...options,
            where: this.withTenantFilter(options?.where as FindOptionsWhere<Entity>),
        });
    }

    create(entityLike: DeepPartial<Entity>): Entity {
        const tenantId = this.getRequiredTenantId();
        return this.repository.create({ ...entityLike, tenantId } as DeepPartial<Entity>);
    }

    async save(entity: DeepPartial<Entity>, options?: SaveOptions): Promise<Entity> {
        const tenantId = this.getRequiredTenantId();
        return this.repository.save({ ...entity, tenantId } as DeepPartial<Entity>, options);
    }

    async saveMany(entities: DeepPartial<Entity>[], options?: SaveOptions): Promise<Entity[]> {
        const tenantId = this.getRequiredTenantId();
        const entitiesWithTenant = entities.map((e) => ({ ...e, tenantId })) as DeepPartial<Entity>[];
        return this.repository.save(entitiesWithTenant, options);
    }

    async update(id: string, partialEntity: DeepPartial<Entity>): Promise<Entity | null> {
        const existing = await this.findOneById(id);
        if (!existing) return null;
        return this.repository.save({ ...existing, ...partialEntity } as DeepPartial<Entity>);
    }

    async softDelete(id: string): Promise<boolean> {
        const tenantId = this.getRequiredTenantId();
        const result = await this.repository.softDelete({
            id,
            tenantId,
        } as unknown as FindOptionsWhere<Entity>);
        return (result.affected ?? 0) > 0;
    }

    async delete(id: string): Promise<boolean> {
        const tenantId = this.getRequiredTenantId();
        const result = await this.repository.delete({
            id,
            tenantId,
        } as unknown as FindOptionsWhere<Entity>);
        return (result.affected ?? 0) > 0;
    }

    createQueryBuilder(alias: string): SelectQueryBuilder<Entity> {
        const tenantId = this.getRequiredTenantId();
        return this.repository
            .createQueryBuilder(alias)
            .where(`${alias}.tenantId = :tenantId`, { tenantId });
    }

    getRepository(): Repository<Entity> {
        return this.repository;
    }
}

export function InjectTenantAwareRepository(entity: EntityTarget<ObjectLiteral>): ParameterDecorator {
    return Inject(`TENANT_AWARE_REPOSITORY_${(entity as Type<any>).name}`);
}

export function createTenantAwareRepositoryProvider<Entity extends ObjectLiteral>(
    entity: EntityTarget<Entity>,
) {
    return {
        provide: `TENANT_AWARE_REPOSITORY_${(entity as Type<any>).name}`,
        useFactory: (dataSource: DataSource, tenantContext: ClsTenantContextService) =>
            new TenantAwareRepository<Entity>(dataSource, tenantContext, entity),
        inject: [DataSource, ClsTenantContextService],
    };
}
