import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import type { IPrismaDelegate, ITenantReadOptions, ITenantScopedDelegate } from '@app/types';

import { TenantContextService } from './tenant-context.service';

/**
 * Prisma Tenant-Aware Service
 *
 * Provides tenant-scoped database operations via the proxy pattern.
 * All operations auto-inject `tenantId` and apply soft-delete guards.
 *
 * @example
 * ```typescript
 * // In your service constructor, create a tenant-scoped accessor:
 * private get toto() {
 *     return this.tenantAware.forModel(this.prisma.toto);
 * }
 *
 * // All operations are now tenant-scoped:
 * await this.toto.create({ data: dto });              // auto-injects tenantId
 * await this.toto.findMany({ where: { status } });    // filters by tenantId + excludes deleted
 * await this.toto.findUnique({ where: { id } });      // scoped to tenant
 * await this.toto.update({ where: { id }, data });    // scoped to tenant
 * await this.toto.delete({ where: { id } });          // soft-delete (sets deletedAt)
 * await this.toto.hardDelete({ where: { id } });      // permanent delete
 * await this.toto.count();                            // count for tenant
 *
 * // For pagination or complex queries, use withTenantFilter:
 * const where = this.tenantAware.withTenantFilter({ status: 'active' });
 * await prismaPaginate(query, this.prisma.toto, config, where);
 * ```
 */
@Injectable()
export class TenantAwareService {
    constructor(private readonly tenantContext: TenantContextService) {}

    /**
     * Create a tenant-scoped proxy for a Prisma model delegate.
     * All methods auto-inject tenantId and apply soft-delete guards.
     *
     * @param delegate - Prisma model delegate (e.g., `this.prisma.toto`)
     */
    forModel<T>(delegate: IPrismaDelegate<T>): ITenantScopedDelegate<T> {
        return {
            create: (args: { data: Record<string, unknown>; select?: unknown; include?: unknown }) => {
                const tenantId = this.getRequiredTenantId();
                return delegate.create({
                    ...args,
                    data: { ...args.data, tenantId }
                });
            },

            findMany: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options);
                return delegate.findMany({ ...args, where });
            },

            findUnique: (
                args: {
                    where: Record<string, unknown>;
                    select?: unknown;
                    include?: unknown;
                },
                options: ITenantReadOptions = {}
            ) => {
                const where = this.scopeWhere(args.where, options);
                return delegate.findUnique({ ...args, where });
            },

            findFirst: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options);
                return delegate.findFirst({ ...args, where });
            },

            findFirstOrThrow: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options);
                return delegate.findFirstOrThrow({ ...args, where });
            },

            update: (args: { where: Record<string, unknown>; data: Record<string, unknown>; select?: unknown; include?: unknown }) => {
                const tenantId = this.getRequiredTenantId();
                const where = { ...args.where, tenantId };
                return delegate.update({ ...args, where });
            },

            delete: (args: { where: Record<string, unknown> }) => {
                const tenantId = this.getRequiredTenantId();
                const where = { ...args.where, tenantId };
                return delegate.update({ where, data: { deletedAt: new Date() } });
            },

            hardDelete: (args: { where: Record<string, unknown> }) => {
                const tenantId = this.getRequiredTenantId();
                const where = { ...args.where, tenantId };
                return delegate.delete({ where });
            },

            count: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options);
                return delegate.count({ ...args, where });
            }
        };
    }

    /**
     * Get the current tenant ID from context.
     * Throws UNAUTHORIZED if not set.
     */
    getRequiredTenantId(): string {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) {
            throw new HttpException(
                {
                    message: 'Tenant context is required but not set',
                    errorCode: 'TENANT_CONTEXT_REQUIRED'
                },
                HttpStatus.UNAUTHORIZED
            );
        }
        return tenantId;
    }

    /**
     * Build a tenant-scoped where clause for direct Prisma queries.
     * Use for pagination or complex queries not covered by forModel().
     *
     * @param where - Base where conditions
     * @param options - { includeSoftDeleted: true } to include deleted records
     */
    withTenantFilter<T extends Record<string, unknown>>(
        where: T = {} as T,
        options: { includeSoftDeleted?: boolean } = {}
    ): T & { tenantId: string; deletedAt?: null } {
        const tenantId = this.getRequiredTenantId();
        const result = { ...where, tenantId } as T & {
            tenantId: string;
            deletedAt?: null;
        };

        if (!options.includeSoftDeleted && !('deletedAt' in where)) {
            result.deletedAt = null;
        }

        return result;
    }

    /**
     * Add soft-delete filter to a where clause.
     */
    withSoftDelete<T extends Record<string, unknown>>(where: T = {} as T): T & { deletedAt: null } {
        return { ...where, deletedAt: null };
    }

    /**
     * Get soft-delete update data.
     */
    softDeleteData(): { deletedAt: Date } {
        return { deletedAt: new Date() };
    }

    private scopeWhere(where: Record<string, unknown> = {}, options: ITenantReadOptions = {}): Record<string, unknown> {
        const tenantId = this.getRequiredTenantId();
        const scoped: Record<string, unknown> = { ...where, tenantId };

        if (!options.includeSoftDeleted && !('deletedAt' in where)) {
            scoped.deletedAt = null;
        }

        return scoped;
    }
}
