import { HttpStatus, Injectable } from '@nestjs/common';

import type { IPrismaDelegate, ITenantReadOptions, ITenantScopedDelegate } from '@app/types';

import { BaseException } from '@common/exceptions/base.exceptions';
import { TenantContextService } from './tenant-context.service';

/**
 * Prisma Tenant-Aware Service
 *
 * Provides tenant-scoped database operations via the proxy pattern.
 * All operations auto-inject `tenantId`. Soft-delete guards apply only to models that have a `deletedAt`
 * column (read from Prisma's field references), so a model without one (`audit_log`, `provider_connections`)
 * is never queried on a column it lacks (US1.9.2 F2, US1.5.1, US1.5.3).
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
 * await this.toto.delete({ where: { id } });          // soft-delete (sets deletedAt); a real delete without the column
 * await this.toto.hardDelete({ where: { id } });      // permanent delete
 * await this.toto.count();                            // count for tenant
 *
 * // For pagination or complex queries, use withTenantFilter (tenant only: state `deletedAt: null` yourself):
 * const where = this.tenantAware.withTenantFilter({ status: 'active', deletedAt: null });
 * await cursorPage(this.prisma.toto, where, query, toItem);
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
        const softDeletes = (delegate.fields as Record<string, unknown> | undefined)?.deletedAt !== undefined;
        return {
            create: (args: { data: Record<string, unknown>; select?: unknown; include?: unknown }) => {
                const tenantId = this.getRequiredTenantId();
                return delegate.create({
                    ...args,
                    data: { ...args.data, tenantId }
                });
            },

            findMany: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options, softDeletes);
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
                const where = this.scopeWhere(args.where, options, softDeletes);
                return delegate.findUnique({ ...args, where });
            },

            findFirst: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options, softDeletes);
                return delegate.findFirst({ ...args, where });
            },

            findFirstOrThrow: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options, softDeletes);
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
                return softDeletes ? delegate.update({ where, data: { deletedAt: new Date() } }) : delegate.delete({ where });
            },

            hardDelete: (args: { where: Record<string, unknown> }) => {
                const tenantId = this.getRequiredTenantId();
                const where = { ...args.where, tenantId };
                return delegate.delete({ where });
            },

            count: (args = {}, options: ITenantReadOptions = {}) => {
                const where = this.scopeWhere(args.where, options, softDeletes);
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
            throw new BaseException('tenant_context_required', 'Tenant context is required but not set', HttpStatus.UNAUTHORIZED);
        }
        return tenantId;
    }

    /**
     * Build a tenant-scoped where clause for direct Prisma queries.
     * Use for pagination or complex queries not covered by forModel().
     *
     * Adds the tenant only. It doesn't know the model, so it can't tell whether a `deletedAt` column exists:
     * a caller listing a soft-deleting model states `deletedAt: null` itself (US1.9.2 F2: the implicit
     * default queried `audit_log` on a column it doesn't have, so every read failed).
     *
     * @param where - Base where conditions
     */
    withTenantFilter<T extends Record<string, unknown>>(where: T = {} as T): T & { tenantId: string } {
        return { ...where, tenantId: this.getRequiredTenantId() };
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

    private scopeWhere(where: Record<string, unknown> = {}, options: ITenantReadOptions = {}, softDeletes = true): Record<string, unknown> {
        const tenantId = this.getRequiredTenantId();
        const scoped: Record<string, unknown> = { ...where, tenantId };

        if (softDeletes && !options.includeSoftDeleted && !('deletedAt' in where)) {
            scoped.deletedAt = null;
        }

        return scoped;
    }
}
