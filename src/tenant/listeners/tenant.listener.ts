import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { AuditService } from '@mod/common/audit/audit.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { Utils } from '@mod/common/utils/utils';
import { KetoRelationTupleDto } from '@mod/common/auth/dto/keto-relation-tuple.dto';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { CreateAuditLogDto } from '@mod/common/audit/create-audit-log.dto';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { TenantEntity } from '../tenant.entity';
import { UpdateTenantDto } from '../dto/tenant/update-tenant.dto';
import { HttpClient } from '@mod/common/http/http.client';
import { ConfigService, ConfigType } from '@nestjs/config';
import oryConfig from '@mod/config/ory.config';

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TENANT_DELETION_QUEUE, TenantDeletionJobData } from '@mod/common/bullmq/queues/tenant-deletion.queue';

@Injectable()
export class TenantListener {
    private readonly ketoWriteUrl: string;

    constructor(
        private readonly sns: SnsPublisher,
        private readonly auditService: AuditService,
        private readonly ketoService: KetoService,
        @InjectQueue(TENANT_DELETION_QUEUE) private readonly deletionQueue: Queue<TenantDeletionJobData>,
        private readonly httpClient: HttpClient,
        private readonly configService: ConfigService
    ) {
        const oryCfg = this.configService.getOrThrow<ConfigType<typeof oryConfig>>('oryConfig', { infer: true });
        this.ketoWriteUrl = oryCfg.keto.writeUrl;
    }

    @OnEvent('tenant.created')
    async handleTenantCreatedEvent(payload: { tenant: TenantEntity; ownerId: string }) {
        const { tenant, ownerId } = payload;

        // 1. Create Keto tuple
        const tuple = await Utils.validateDtoOrFail(KetoRelationTupleDto, {
            namespace: KetoNamespace.TENANT,
            object: tenant.id,
            relation: KetoRelation.MEMBER,
            subject_id: ownerId
        });
        await this.ketoService.createTuple(tuple);

        // 2. Audit Log
        const auditLogDto = await Utils.validateDtoOrFail(CreateAuditLogDto, {
            tenantId: tenant.id,
            userId: ownerId,
            action: AuditAction.TENANT_CREATED,
            description: `Tenant "${tenant.name}" created`,
            metadata: {
                slug: tenant.slug
            }
        });
        await this.auditService.log(auditLogDto);

        // 3. Publish SNS Event
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: tenant.id,
            eventType: 'tenant.created',
            data: {
                ...tenant,
                ownerId: ownerId
            } as any,
            timestamp: new Date().toISOString()
        });
        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: tenant.id,
            deduplicationId: tenant.id
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);
    }

    @OnEvent('tenant.updated')
    async handleTenantUpdatedEvent(payload: {
        tenant: TenantEntity;
        oldTenant: TenantEntity;
        changes: UpdateTenantDto;
        userId?: string;
        userEmail?: string;
        ipAddress?: string;
    }) {
        const { tenant, oldTenant, changes, userId, userEmail, ipAddress } = payload;

        // 1. Audit Log
        await this.auditService.log({
            tenantId: tenant.id,
            userId,
            userEmail,
            action: AuditAction.TENANT_UPDATED,
            description: `Tenant "${tenant.name}" updated`,
            metadata: {
                changes: changes,
                previousValues: {
                    name: oldTenant.name,
                    slug: oldTenant.slug,
                    status: oldTenant.status
                }
            },
            ipAddress
        });

        // 2. Publish SNS Event
        await this.sns.publish(
            {
                eventId: tenant.id,
                eventType: 'tenant.updated',
                data: {
                    ...tenant,
                    changes: changes
                } as unknown as any,
                timestamp: new Date().toISOString()
            },
            {
                topic: 'tenant-events',
                groupId: tenant.id,
                deduplicationId: `${tenant.id}-${Date.now()}`
            }
        );
    }

    @OnEvent('tenant.deletion.scheduled')
    async handleTenantDeletionScheduledEvent(payload: {
        tenant: TenantEntity;
        userId: string;
        scheduledAt: Date;
        executionDate: Date;
        reason?: string;
        ipAddress?: string;
    }) {
        const { tenant, userId, scheduledAt, executionDate, reason, ipAddress } = payload;

        // 1. Audit Log
        await this.auditService.log({
            tenantId: tenant.id,
            userId,
            action: AuditAction.TENANT_DELETION_SCHEDULED,
            description: `Tenant "${tenant.name}" deletion scheduled for ${executionDate.toISOString()}`,
            metadata: {
                scheduledAt: scheduledAt.toISOString(),
                executionDate: executionDate.toISOString(),
                reason: reason || 'No reason provided'
            },
            ipAddress
        });

        // 2. Publish SNS Event
        await this.sns.publish(
            {
                eventId: tenant.id,
                eventType: 'tenant.deletion.scheduled',
                data: {
                    tenantId: tenant.id,
                    tenantName: tenant.name,
                    scheduledAt: scheduledAt.toISOString(),
                    executionDate: executionDate.toISOString(),
                    reason
                } as unknown as any,
                timestamp: new Date().toISOString()
            },
            {
                topic: 'tenant-events',
                groupId: tenant.id,
                deduplicationId: `${tenant.id}-deletion-scheduled-${Date.now()}`
            }
        );

        // 3. Schedule Background Job
        const delay = executionDate.getTime() - Date.now();
        await this.deletionQueue.add(
            'execute-deletion',
            {
                tenantId: tenant.id,
                scheduledAt: scheduledAt.toISOString(),
                executionDate: executionDate.toISOString(),
                reason
            },
            {
                jobId: `deletion-${tenant.id}`, // Custom Job ID for easy retrieval
                delay: Math.max(0, delay) // Ensure non-negative delay
            }
        );
    }

    @OnEvent('tenant.deletion.cancelled')
    async handleTenantDeletionCancelledEvent(payload: { tenant: TenantEntity; userId: string; ipAddress?: string }) {
        const { tenant, userId, ipAddress } = payload;

        // 1. Audit Log
        await this.auditService.log({
            tenantId: tenant.id,
            userId,
            action: AuditAction.TENANT_DELETION_CANCELLED,
            description: `Tenant "${tenant.name}" deletion cancelled`,
            metadata: {
                cancelledAt: new Date().toISOString()
            },
            ipAddress
        });

        // 2. Publish SNS Event
        await this.sns.publish(
            {
                eventId: tenant.id,
                eventType: 'tenant.deletion.cancelled',
                data: {
                    tenantId: tenant.id,
                    tenantName: tenant.name
                } as unknown as any,
                timestamp: new Date().toISOString()
            },
            {
                topic: 'tenant-events',
                groupId: tenant.id,
                deduplicationId: `${tenant.id}-deletion-cancelled-${Date.now()}`
            }
        );

        // 3. Cancel Background Job
        const job = await this.deletionQueue.getJob(`deletion-${tenant.id}`);
        if (job) {
            await job.remove();
        }
    }

    @OnEvent('tenant.deleted')
    async handleTenantDeletedEvent(payload: { tenant: TenantEntity; deletedAt: Date }) {
        const { tenant, deletedAt } = payload;

        // 1. Audit Log (before tenant is deleted)
        await this.auditService.log({
            tenantId: tenant.id,
            action: AuditAction.TENANT_DELETED,
            description: `Tenant "${tenant.name}" permanently deleted`,
            metadata: {
                deletedAt: deletedAt.toISOString(),
                tenantSlug: tenant.slug
            }
        });

        // 2. Publish SNS Event
        await this.sns.publish(
            {
                eventId: tenant.id,
                eventType: 'tenant.deleted',
                data: {
                    tenantId: tenant.id,
                    tenantName: tenant.name,
                    tenantSlug: tenant.slug,
                    deletedAt: deletedAt.toISOString()
                } as unknown as any,
                timestamp: new Date().toISOString()
            },
            {
                topic: 'tenant-events',
                groupId: tenant.id,
                deduplicationId: `${tenant.id}-deleted-${Date.now()}`
            }
        );

        // 3. Cleanup Tasks
        // 3a. Remove all Keto relations for this tenant
        const ketoRelations = await this.queryKetoRelationsForTenant(tenant.id);
        for (const relation of ketoRelations) {
            await this.ketoService.deleteTuple(relation);
        }

        // 3b. Delete S3 files associated with this tenant
        // Note: Files are typically stored with tenant-specific prefixes or linked via FileEntity
        // This is a placeholder - actual implementation depends on your S3 key structure
        // If you have a tenant-specific prefix like `tenants/{tenantId}/`, you can delete all files under it
        // For now, we'll log that this cleanup should happen
        console.log(`S3 cleanup for tenant ${tenant.id} should be handled by listening services`);

        // 3c. Other services will handle their own cleanup by listening to the SNS event
        // Examples: Campaign service, Reward service, etc.
    }

    /**
     * Query all Keto relations for a tenant
     * This queries the Keto API to find all relations where the tenant is the object
     */
    private async queryKetoRelationsForTenant(tenantId: string): Promise<
        Array<{
            namespace: string;
            object: string;
            relation: string;
            subject_id?: string;
        }>
    > {
        const { data } = await this.httpClient.get<{
            relation_tuples?: Array<{
                namespace: string;
                object: string;
                relation: string;
                subject_id?: string;
            }>;
        }>(`${this.ketoWriteUrl}/admin/relation-tuples`, {
            params: {
                namespace: 'tenants',
                object: tenantId
            }
        });

        return data.relation_tuples || [];
    }
}
