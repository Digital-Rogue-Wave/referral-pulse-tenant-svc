import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IBaseJobData, IJobResult } from '@app/types';

import { KetoProvisioningService } from '@common/auth/authz/keto-provisioning.service';
import { CATALOG_VERSION } from '@common/auth/authz/permission-catalog';
import { BaseWorkerService, BullJobsConnectionFactory, BullJobsService } from '@common/bulljobs';
import { RoleEnum } from '@common/enums/role.enum';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { RedisService } from '@common/redis/redis.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';
import { DatabaseService } from '@app/database/database.service';

const RECONCILER_QUEUE = 'keto-reconciler';
const RECONCILE_JOB = 'reconcile-keto';
const TENANT_PAGE = 100;
/** Deleted tenants are re-revoked for this long, which bounds the sweep while covering any missed revocation. */
const REVOKE_LOOKBACK_DAYS = 30;
/** Marks a catalogue version as applied; long enough that a version is never re-applied by expiry in practice. */
const CATALOG_MARKER_TTL_SECONDS = 400 * 24 * 60 * 60;
const catalogMarkerKey = (version: string): string => `keto:catalog-applied:${version}`;

interface ReconcileJobData extends IBaseJobData {
    /** Set on the one run a catalogue change triggers: it also deletes the retired namespaces' tuples. */
    catalogVersion?: string;
}

/**
 * Nightly repair of Ory Keto from the membership write model (`users`): makes every live tenant's role
 * grants exactly the catalogue's, re-writes every member's role, removes memberships of removed users,
 * and re-revokes recently deleted tenants. All writes are idempotent, so a run is a no-op when Keto is
 * already in sync.
 *
 * A catalogue change (CATALOG_VERSION) is applied once, on the first worker start that sees it, by an
 * immediate run that also deletes the retired namespaces' tuples — the v5.1 re-provisioning (E1 D2).
 */
@Injectable()
export class KetoReconcilerWorker extends BaseWorkerService<ReconcileJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly prisma: DatabaseService,
        private readonly bullJobs: BullJobsService,
        private readonly ketoProvisioning: KetoProvisioningService,
        private readonly redis: RedisService
    ) {
        super(RECONCILER_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    override onModuleInit(): void {
        super.onModuleInit();
        if (this.configService.get<boolean>('app.isWorker', { infer: true })) {
            void this.bullJobs.addRepeatingJob(RECONCILER_QUEUE, RECONCILE_JOB, { tenantId: 'system' }, { pattern: '30 3 * * *' });
            void this.applyCatalogOnce();
        }
    }

    /** Several worker pods may start together; the NX marker lets exactly one enqueue the re-provisioning. */
    private async applyCatalogOnce(): Promise<void> {
        const first = await this.redis.setNx(catalogMarkerKey(CATALOG_VERSION), new Date().toISOString(), CATALOG_MARKER_TTL_SECONDS);
        if (first) {
            this.logger.log('Permission catalogue changed — re-provisioning Keto for every tenant', { catalogVersion: CATALOG_VERSION });
            await this.bullJobs.addJob(RECONCILER_QUEUE, RECONCILE_JOB, { tenantId: 'system', catalogVersion: CATALOG_VERSION });
        }
    }

    protected async processJob(job: Job<ReconcileJobData>): Promise<IJobResult> {
        if (job.data?.catalogVersion) {
            await this.ketoProvisioning.retireNamespaces();
        }
        let tenants = 0;
        let cursor: string | undefined;
        for (;;) {
            const page = await this.prisma.tenant.findMany({
                where: { deletedAt: null },
                orderBy: { id: 'asc' },
                take: TENANT_PAGE,
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
                select: { id: true }
            });
            for (const tenant of page) {
                await this.reconcileTenant(tenant.id);
            }
            tenants += page.length;
            const last = page.at(-1);
            if (!last || page.length < TENANT_PAGE) {
                break;
            }
            cursor = last.id;
        }

        const since = new Date(Date.now() - REVOKE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const deleted = await this.prisma.tenant.findMany({ where: { deletedAt: { gte: since } }, select: { id: true } });
        for (const tenant of deleted) {
            await this.ketoProvisioning.revokeTenant(tenant.id);
        }

        this.logger.log('Keto reconciliation complete', { tenants, revoked: deleted.length });
        return { success: true, data: { tenants, revoked: deleted.length } };
    }

    private async reconcileTenant(tenantId: string): Promise<void> {
        await this.ketoProvisioning.grantTenant(tenantId);
        const members = await this.prisma.user.findMany({ where: { tenantId }, select: { id: true, role: true, deletedAt: true } });
        for (const member of members) {
            if (member.deletedAt) {
                await this.ketoProvisioning.removeMember(tenantId, member.id);
            } else {
                await this.ketoProvisioning.assignRole(tenantId, member.id, member.role as RoleEnum);
            }
        }
    }
}
