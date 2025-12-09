import { DynamicModule, Inject, Module, Provider } from '@nestjs/common';
import {
    DataSource,
    DeepPartial,
    DeleteResult,
    EntityTarget,
    FindManyOptions,
    FindOptionsWhere,
    FindOptionsRelations,
    FindOptionsSelect,
    ObjectLiteral,
    Repository,
    SaveOptions,
    SelectQueryBuilder,
    UpdateResult,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';

/** Token helper to inject a tenant-aware repository for a given entity */
export const InjectTenantAwareRepository = <T extends ObjectLiteral>(entity: EntityTarget<T>) =>
    Inject(`TenantAwareRepository_${typeof entity === 'function' ? entity.name : String(entity)}`);

/** Provider factory for a tenant-aware repository */
export function createTenantAwareRepositoryProvider<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
): Provider {
    const token = `TenantAwareRepository_${typeof entity === 'function' ? entity.name : String(entity)}`;
    return {
        provide: token,
        useFactory: (dataSource: DataSource, cls: ClsService<ClsRequestContext>) =>
            new TenantAwareRepository<T>(entity, dataSource, cls),
        inject: [DataSource, ClsService],
    };
}

/** Options for claiming a batch (generic Outbox-like usage) */
export interface ClaimConfig<E extends ObjectLiteral> {
    statusColumn: keyof E & string;
    pendingValue: unknown;
    inProgressValue: unknown;
    createdAtColumn: keyof E & string;
    nextAttemptAtColumn: keyof E & string;
    scheduleAtColumn?: (keyof E & string) | undefined;
}

/** Narrow check for PG unique violation */
function isPgUniqueViolation(err: unknown): err is { code: string } {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

/** Tenant-aware repository with CLS-based scoping */
export class TenantAwareRepository<Entity extends ObjectLiteral> extends Repository<Entity> {
    constructor(
        private readonly entityTarget: EntityTarget<Entity>,
        dataSource: DataSource,
        private readonly cls: ClsService<ClsRequestContext>,
    ) {
        super(entityTarget, dataSource.createEntityManager());
    }

    // -------------- Utilities

    private getTenantId(): string {
        const tenantId = this.cls.get('tenantId');
        if (!tenantId) {
            throw new Error('TenantAwareRepository: tenantId missing in CLS context');
        }
        return tenantId;
    }

    private mergeTenantIntoWhere(
        where?: FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[],
    ): FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[] | undefined {
        const tenantId = this.getTenantId();
        if (!where) return { tenantId } as unknown as FindOptionsWhere<Entity>;
        if (Array.isArray(where)) {
            return where.map(
                (w) => ({ ...(w as Record<string, unknown>), tenantId }) as unknown as FindOptionsWhere<Entity>,
            );
        }
        return { ...(where as Record<string, unknown>), tenantId } as unknown as FindOptionsWhere<Entity>;
    }

    private withTenantOnPartial<TP extends DeepPartial<Entity>>(partial: TP): TP {
        const tenantId = this.getTenantId();
        const merged = { ...(partial as Record<string, unknown>), tenantId } as unknown as TP;
        return merged;
    }

    private columnName<K extends keyof Entity & string>(prop: K): string {
        const col = this.metadata.findColumnWithPropertyName(prop);
        return col?.databaseName ?? prop;
    }

    private tableName(): string {
        return this.metadata.tablePath; // includes schema if present
    }

    // -------------- Overridden methods (inject tenant automatically)

    override find(options?: FindManyOptions<Entity>): Promise<Entity[]> {
        const where = this.mergeTenantIntoWhere(options?.where);
        return super.find({ ...(options ?? {}), where });
    }

    override findOne(options: Parameters<Repository<Entity>['findOne']>[0]): Promise<Entity | null> {
        const where = this.mergeTenantIntoWhere(options?.where);
        return super.findOne({ ...(options ?? {}), where });
    }

    override create(): Entity;
    override create(entries: DeepPartial<Entity>[]): Entity[];
    override create(entry: DeepPartial<Entity>): Entity;
    override create(input?: DeepPartial<Entity> | DeepPartial<Entity>[]): Entity | Entity[] {
        if (!input) {
            const e = super.create() as Entity;
            (e as unknown as Record<string, unknown>).tenantId = this.getTenantId();
            return e;
        }
        if (Array.isArray(input)) {
            const arr = input.map((i) => this.withTenantOnPartial(i));
            return super.create(arr);
        }
        return super.create(this.withTenantOnPartial(input));
    }

    override save<T extends DeepPartial<Entity>>(entity: T, options?: SaveOptions): Promise<T & Entity>;
    override save<T extends DeepPartial<Entity>>(entities: T[], options?: SaveOptions): Promise<(T & Entity)[]>;
    override async save<T extends DeepPartial<Entity>>(
        entityOrEntities: T | T[],
        options?: SaveOptions,
    ): Promise<(T & Entity) | (T & Entity)[]> {
        if (Array.isArray(entityOrEntities)) {
            const arr = entityOrEntities.map((e) => this.withTenantOnPartial(e));
            return super.save(arr, options);
        }
        return super.save(this.withTenantOnPartial(entityOrEntities), options);
    }

    // -------------- Convenience helpers (backwards compatible)

    async findTenantContext(options?: FindManyOptions<Entity>): Promise<Entity[]> {
        return this.find(options);
    }

    async findOneTenantContext(
        fields: FindOptionsWhere<Entity>,
        relations?: FindOptionsRelations<Entity>,
        select?: FindOptionsSelect<Entity>,
    ): Promise<Entity | null> {
        return this.findOne({ where: fields, relations, select });
    }

    async findOneOrFailTenantContext(fields: FindOptionsWhere<Entity>): Promise<Entity> {
        const e = await this.findOne({ where: fields });
        if (!e) throw new Error('Entity not found in tenant context');
        return e;
    }

    createTenantContext(entry: DeepPartial<Entity>): Entity {
        return this.create(entry);
    }

    createManyTenantContext(entries: DeepPartial<Entity>[]): Entity[] {
        return this.create(entries);
    }

    async saveTenantContext(entry: DeepPartial<Entity>, options?: SaveOptions): Promise<Entity> {
        return (await this.save(entry, options)) as unknown as Entity;
    }

    async saveManyTenantContext(entries: DeepPartial<Entity>[], options?: SaveOptions): Promise<Entity[]> {
        return (await this.save(entries, options)) as unknown as Entity[];
    }

    async softDeleteTenantContext(criteria: FindOptionsWhere<Entity>): Promise<DeleteResult> {
        const tenantId = this.getTenantId();
        const where = { ...(criteria as Record<string, unknown>), tenantId } as unknown as FindOptionsWhere<Entity>;
        return super.softDelete(where);
    }

    async deleteTenantContext(criteria: FindOptionsWhere<Entity>): Promise<DeleteResult> {
        const tenantId = this.getTenantId();
        const where = { ...(criteria as Record<string, unknown>), tenantId } as unknown as FindOptionsWhere<Entity>;
        return super.delete(where);
    }

    async getTotalTenantContext(where?: FindOptionsWhere<Entity>): Promise<number> {
        const merged = this.mergeTenantIntoWhere(where);
        return super.count({ where: merged });
    }

    createTenantContextQueryBuilder(alias: string): SelectQueryBuilder<Entity> {
        const tenantId = this.getTenantId();
        return super.createQueryBuilder(alias).andWhere(`${alias}.tenantId = :tenantId`, { tenantId });
    }

    // -------------- Generic outbox helpers

    async saveWithIdempotency(
        partial: DeepPartial<Entity>,
        idempotencyKeyField: keyof Entity & string,
        options?: SaveOptions,
    ): Promise<Entity> {
        const value = (partial as Record<string, unknown>)[idempotencyKeyField];
        if (value == null) {
            return (await this.save(partial, options)) as unknown as Entity;
        }

        try {
            return (await this.save(partial, options)) as unknown as Entity;
        } catch (err) {
            if (!isPgUniqueViolation(err)) throw err;

            const tenantId = this.getTenantId();
            const where = {
                [idempotencyKeyField]: value,
                tenantId,
            } as unknown as FindOptionsWhere<Entity>;

            const existing = await super.findOne({ where });
            if (existing) return existing;
            return (await this.save(partial, options)) as unknown as Entity;
        }
    }

    async claimPendingBatch(cfg: ClaimConfig<Entity>, limit: number): Promise<Entity[]> {
        const tenantId = this.getTenantId();
        const table = this.tableName();
        const tenantCol = this.columnName('tenantId' as keyof Entity & string);
        const statusCol = this.columnName(cfg.statusColumn);
        const createdAtCol = this.columnName(cfg.createdAtColumn);
        const nextAttemptAtCol = this.columnName(cfg.nextAttemptAtColumn);
        const scheduleAtCol = cfg.scheduleAtColumn ? this.columnName(cfg.scheduleAtColumn) : undefined;

        const sql = `
WITH pick AS (
  SELECT id
  FROM ${table}
  WHERE ${tenantCol} = $1
    AND ${statusCol} = $2
    AND (${nextAttemptAtCol} IS NULL OR ${nextAttemptAtCol} <= NOW())
    ${scheduleAtCol ? `AND (${scheduleAtCol} IS NULL OR ${scheduleAtCol} <= NOW())` : ''}
  ORDER BY ${createdAtCol} ASC
  LIMIT $3
  FOR UPDATE SKIP LOCKED
)
UPDATE ${table} t
SET ${statusCol} = $4
WHERE t.id IN (SELECT id FROM pick)
RETURNING t.*;
`.trim();

        const rows = (await this.manager.query(sql, [tenantId, cfg.pendingValue, limit, cfg.inProgressValue])) as Entity[];
        return rows;
    }

    async updateStatusById(id: string, statusColumn: keyof Entity & string, newStatus: unknown): Promise<void> {
        const tenantId = this.getTenantId();
        const where = { id, tenantId } as unknown as FindOptionsWhere<Entity>;
        const set = { [statusColumn]: newStatus } as unknown as QueryDeepPartialEntity<Entity>;
        await super.update(where, set);
    }

    async markFailureWithBackoff(
        id: string,
        attemptsColumn: keyof Entity & string,
        nextAttemptAtColumn: keyof Entity & string,
        statusColumn: keyof Entity & string,
        pendingValue: unknown,
        attempts: number,
        baseDelaySec = 5,
        capSec = 60 * 60,
    ): Promise<void> {
        const tenantId = this.getTenantId();
        const where = { id, tenantId } as unknown as FindOptionsWhere<Entity>;

        const backoffSec = Math.min(capSec, Math.pow(2, attempts) * baseDelaySec);
        const next = new Date(Date.now() + backoffSec * 1000);

        const set = {
            [statusColumn]: pendingValue,
            [attemptsColumn]: attempts + 1,
            [nextAttemptAtColumn]: next,
        } as unknown as QueryDeepPartialEntity<Entity>;

        await super.update(where, set);
    }

    async updateTenantContext(
        criteria:
            | string
            | string[]
            | number
            | number[]
            | Date
            | Date[]
            | { id: string | number }
            | FindOptionsWhere<Entity>
            | FindOptionsWhere<Entity>[],
        partialEntity: QueryDeepPartialEntity<Entity>,
    ): Promise<UpdateResult> {
        const tenantId = this.getTenantId();

        if (Array.isArray(criteria)) {
            if (criteria.length > 0 && typeof criteria[0] === 'object') {
                const arr = (criteria as FindOptionsWhere<Entity>[]).map(
                    (c) => ({ ...(c as Record<string, unknown>), tenantId }) as unknown as FindOptionsWhere<Entity>,
                );
                return super.update(arr, partialEntity);
            }
            return super.update(
                { id: criteria as unknown, tenantId } as unknown as FindOptionsWhere<Entity>,
                partialEntity,
            );
        }

        if (typeof criteria === 'object' && criteria !== null) {
            const where = { ...(criteria as Record<string, unknown>), tenantId } as unknown as FindOptionsWhere<Entity>;
            return super.update(where, partialEntity);
        }

        const where = { id: criteria as unknown as string | number, tenantId } as unknown as FindOptionsWhere<Entity>;
        return super.update(where, partialEntity);
    }
}

/** Dynamic module to register tenant-aware repositories for multiple entities */
@Module({})
export class TenantAwareRepositoryModule {
    static forEntities(entities: EntityTarget<ObjectLiteral>[]): DynamicModule {
        const providers = entities.map((e) => createTenantAwareRepositoryProvider(e));
        return {
            module: TenantAwareRepositoryModule,
            providers,
            exports: providers,
        };
    }
}
