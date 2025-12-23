import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { AuditService } from '@mod/common/audit/audit.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { Utils } from '@mod/common/utils/utils';
import { KetoNamespace } from '@mod/common/auth/keto.constants';
import { CreateAuditLogDto } from '@mod/common/audit/create-audit-log.dto';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { HttpClient } from '@mod/common/http/http.client';
import { DomainProvisioningService } from '../dns/domain-provisioning.service';
import { ConfigService, ConfigType } from '@nestjs/config';
import oryConfig from '@mod/config/ory.config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TENANT_DELETION_QUEUE, TenantDeletionJobData } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import {
    TenantCreatedEvent,
    TenantDeletedEvent,
    TenantDeletionCancelledEvent,
    TenantDeletionScheduledEvent,
    TenantDomainVerifiedEvent,
    TenantUpdatedEvent,
    TenantSuspendedEvent,
    TenantUnsuspendedEvent
} from '@mod/common/interfaces/tenant-events.interface';

@Injectable()
export class TenantListener {
    private readonly logger = new Logger(TenantListener.name);
    private readonly ketoReadUrl: string;

    constructor(
        private readonly sns: SnsPublisher,
        private readonly auditService: AuditService,
        private readonly ketoService: KetoService,
        @InjectQueue(TENANT_DELETION_QUEUE) private readonly deletionQueue: Queue<TenantDeletionJobData>,
        private readonly httpClient: HttpClient,
        private readonly configService: ConfigService,
        private readonly domainProvisioningService: DomainProvisioningService
    ) {
        const oryCfg = this.configService.getOrThrow<ConfigType<typeof oryConfig>>('oryConfig', { infer: true });
        this.ketoReadUrl = oryCfg.keto.readUrl;
    }

    @OnEvent('tenant.domain.verified')
    async handleTenantDomainVerifiedEvent(payload: TenantDomainVerifiedEvent) {
        const { tenant } = payload;

        // 1. Audit Log
        await this.auditService.log({
            tenantId: tenant.id,
            userId: 'system',
            action: AuditAction.DOMAIN_VERIFIED,
            description: `Domain ${tenant.customDomain} verified`,
            metadata: {
                domain: tenant.customDomain,
                token: tenant.domainVerificationToken
            }
        });

        // 2. Provision
        if (tenant.customDomain) {
            await this.domainProvisioningService.provisionDomain(tenant.id, tenant.customDomain);
        }
    }

    @OnEvent('tenant.created')
    async handleTenantCreatedEvent(payload: TenantCreatedEvent) {
        this.logger.log(
            `tenant.created event received`,
            JSON.stringify({
                tenantId: payload.tenant.id,
                ownerId: payload.ownerId
            })
        );
        const { tenant, ownerId } = payload;

        // 1. Audit Log
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

        // 2. Publish SNS Event
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: tenant.id,
            eventType: 'tenant.created',
            data: {
                name: tenant.name,
                slug: tenant.slug,
                customDomain: tenant.customDomain,
                ownerId
            },
            timestamp: new Date().toISOString()
        });
        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: tenant.id,
            deduplicationId: tenant.id
        });

        await this.sns.publish(snsEventDto, snsOptionsDto);
    }

    @OnEvent('tenant.updated')
    async handleTenantUpdatedEvent(payload: TenantUpdatedEvent) {
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
        const snsEventDto = {
            eventId: tenant.id,
            eventType: 'tenant.created',
            data: {
                eventId: tenant.id,
                eventType: 'tenant.updated',
                data: {
                    name: tenant.name,
                    slug: tenant.slug,
                    customDomain: tenant.customDomain,
                    changes: changes
                },
                timestamp: new Date().toISOString()
            }
        };
        const snsOptionsDto = {
            topic: 'tenant-events',
            groupId: tenant.id,
            deduplicationId: `${tenant.id}-${Date.now()}`
        };
        await this.sns.publish(snsEventDto, snsOptionsDto);
    }

    @OnEvent('tenant.deletion.scheduled')
    async handleTenantDeletionScheduledEvent(payload: TenantDeletionScheduledEvent) {
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
        const snsEventDto = {
            eventId: tenant.id,
            eventType: 'tenant.created',
            data: {
                eventId: tenant.id,
                eventType: 'tenant.deletion.scheduled',
                data: {
                    tenantId: tenant.id,
                    tenantName: tenant.name,
                    scheduledAt: scheduledAt.toISOString(),
                    executionDate: executionDate.toISOString(),
                    reason
                },
                timestamp: new Date().toISOString()
            }
        };
        const snsOptionsDto = {
            topic: 'tenant-events',
            groupId: tenant.id,
            deduplicationId: `${tenant.id}-deletion-scheduled-${Date.now()}`
        };
        await this.sns.publish(snsEventDto, snsOptionsDto);

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
    async handleTenantDeletionCancelledEvent(payload: TenantDeletionCancelledEvent) {
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
        const snsEventDto = {
            eventId: tenant.id,
            eventType: 'tenant.deletion.cancelled',
            data: {
                tenantId: tenant.id,
                tenantName: tenant.name
            },
            timestamp: new Date().toISOString()
        };
        const snsOptionsDto = {
            topic: 'tenant-events',
            groupId: tenant.id,
            deduplicationId: `${tenant.id}-deletion-cancelled-${Date.now()}`
        };
        await this.sns.publish(snsEventDto, snsOptionsDto);

        // 3. Cancel Background Job
        const job = await this.deletionQueue.getJob(`deletion-${tenant.id}`);
        if (job) {
            await job.remove();
        }
    }

    @OnEvent('tenant.deleted')
    async handleTenantDeletedEvent(payload: TenantDeletedEvent) {
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
        const snsEventDto = {
            eventId: tenant.id,
            eventType: 'tenant.deleted',
            data: {
                tenantId: tenant.id,
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
                deletedAt: deletedAt.toISOString()
            },
            timestamp: new Date().toISOString()
        };
        const snsOptionsDto = {
            topic: 'tenant-events',
            groupId: tenant.id,
            deduplicationId: `${tenant.id}-deleted-${Date.now()}`
        };
        await this.sns.publish(snsEventDto, snsOptionsDto);

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
        }>(`${this.ketoReadUrl}/relation-tuples`, {
            params: {
                namespace: KetoNamespace.TENANT,
                object: tenantId
            }
        });

        return data.relation_tuples || [];
    }

    @OnEvent('tenant.suspended')
    async handleTenantSuspendedEvent(payload: TenantSuspendedEvent) {
        const { tenantId, reason } = payload;
        this.logger.log(`tenant.suspended event received for tenant ${tenantId}`);

        // 1. Audit Log
        await this.auditService.log({
            tenantId,
            action: AuditAction.TENANT_SUSPENDED,
            description: `Tenant account suspended`,
            metadata: { reason }
        });

        // 2. Publish SNS Event (for Campaign Svc etc)
        const snsEventDto = {
            eventId: tenantId,
            eventType: 'tenant.suspended',
            data: { tenantId, reason },
            timestamp: new Date().toISOString()
        };
        const snsOptionsDto = {
            topic: 'tenant-events',
            groupId: tenantId,
            deduplicationId: `${tenantId}-suspended-${Date.now()}`
        };
        await this.sns.publish(snsEventDto as any, snsOptionsDto as any);
    }

    @OnEvent('tenant.unsuspended')
    async handleTenantUnsuspendedEvent(payload: TenantUnsuspendedEvent) {
        const { tenantId } = payload;
        this.logger.log(`tenant.unsuspended event received for tenant ${tenantId}`);

        // 1. Audit Log
        await this.auditService.log({
            tenantId,
            action: AuditAction.TENANT_UNSUSPENDED,
            description: `Tenant account unsuspended`,
            metadata: {}
        });

        // 2. Publish SNS Event
        const snsEventDto = {
            eventId: tenantId,
            eventType: 'tenant.unsuspended',
            data: { tenantId },
            timestamp: new Date().toISOString()
        };
        const snsOptionsDto = {
            topic: 'tenant-events',
            groupId: tenantId,
            deduplicationId: `${tenantId}-unsuspended-${Date.now()}`
        };
        await this.sns.publish(snsEventDto as any, snsOptionsDto as any);
    }
}
