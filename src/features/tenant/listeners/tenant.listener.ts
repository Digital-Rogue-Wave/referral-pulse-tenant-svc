import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService, ConfigType } from '@nestjs/config';

import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { HttpClientService } from '@common/http/http-client.service';
import { KetoService } from '@common/auth/keto.service';
import { KetoNamespace } from '@common/auth/keto.constants';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { BullJobsService } from '@common/bulljobs';
import oryConfig from '@config/ory.config';
import { TENANT_DELETION_QUEUE, TENANT_EVENTS_TOPIC, TenantDeletionJobData } from '@app/types';

import { DomainProvisioningService } from '../../dns/domain-provisioning.service';

import {
    TenantCreatedEvent,
    TenantUpdatedEvent,
    TenantDeletedEvent,
    TenantSuspendedEvent,
    TenantUnsuspendedEvent,
    TenantLockedEvent,
    TenantUnlockedEvent,
    TenantDeletionScheduledEvent,
    TenantDeletionCancelledEvent,
    TenantOwnershipTransferredEvent,
    TenantDomainVerifiedEvent,
    TenantVerificationRequestedEvent,
    TenantVerificationStatusChangedEvent,
    TenantEvents
} from '@domains/tenant/events/tenant.events';

@Injectable()
export class TenantListener {
    private readonly ketoReadUrl: string;

    constructor(
        private readonly sns: SnsPublisherService,
        private readonly ketoService: KetoService,
        private readonly bullJobsService: BullJobsService,
        private readonly httpClient: HttpClientService,
        private readonly configService: ConfigService,
        private readonly domainProvisioningService: DomainProvisioningService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService
    ) {
        this.logger.setContext(TenantListener.name);

        const oryCfg = this.configService.getOrThrow<ConfigType<typeof oryConfig>>('oryConfig', { infer: true });
        this.ketoReadUrl = oryCfg.keto.readUrl;
    }

    @OnEvent(TenantEvents.CREATED)
    async handleTenantCreatedEvent(event: TenantCreatedEvent): Promise<void> {
        this.logger.log(`Handling tenant.created event`, {
            tenantId: event.tenantId,
            ownerId: event.ownerId
        });

        // Publish SNS Event for other services
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    name: event.name,
                    slug: event.slug,
                    ownerId: event.ownerId,
                    trialStartedAt: this.dateService.toISO(event.trialStartedAt),
                    trialEndsAt: this.dateService.toISO(event.trialEndsAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.UPDATED)
    async handleTenantUpdatedEvent(event: TenantUpdatedEvent): Promise<void> {
        this.logger.log(`Handling tenant.updated event`, {
            tenantId: event.tenantId,
            changes: Object.keys(event.changes)
        });

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    changes: event.changes
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.VERIFICATION_REQUESTED)
    async handleTenantVerificationRequestedEvent(event: TenantVerificationRequestedEvent): Promise<void> {
        this.logger.log(`Handling tenant.verification_requested event`, { tenantId: event.tenantId });

        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenant_id: event.tenantId,
                    tenant_name: event.tenantName,
                    requested_by: event.userId ?? null
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.VERIFICATION_STATUS_CHANGED)
    async handleTenantVerificationStatusChangedEvent(event: TenantVerificationStatusChangedEvent): Promise<void> {
        this.logger.log(`Handling tenant.verification_status_changed event`, {
            tenantId: event.tenantId,
            newStatus: event.newStatus
        });

        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenant_id: event.tenantId,
                    previous_status: event.previousStatus,
                    new_status: event.newStatus,
                    reason: event.reason ?? null
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.SUSPENDED)
    async handleTenantSuspendedEvent(event: TenantSuspendedEvent): Promise<void> {
        this.logger.log(`Handling tenant.suspended event`, {
            tenantId: event.tenantId,
            reason: event.reason
        });

        // Publish SNS Event (Campaign service, etc. will pause campaigns)
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    reason: event.reason,
                    suspendedAt: this.dateService.toISO(event.suspendedAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.UNSUSPENDED)
    async handleTenantUnsuspendedEvent(event: TenantUnsuspendedEvent): Promise<void> {
        this.logger.log(`Handling tenant.unsuspended event`, {
            tenantId: event.tenantId
        });

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    unsuspendedAt: this.dateService.toISO(event.unsuspendedAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.LOCKED)
    async handleTenantLockedEvent(event: TenantLockedEvent): Promise<void> {
        this.logger.log(`Handling tenant.locked event`, {
            tenantId: event.tenantId,
            reason: event.reason
        });

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    reason: event.reason,
                    lockUntil: event.lockUntil ? this.dateService.toISO(event.lockUntil) : undefined,
                    lockedAt: this.dateService.toISO(event.lockedAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.UNLOCKED)
    async handleTenantUnlockedEvent(event: TenantUnlockedEvent): Promise<void> {
        this.logger.log(`Handling tenant.unlocked event`, {
            tenantId: event.tenantId,
            unlockedBy: event.unlockedBy
        });

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    unlockedBy: event.unlockedBy,
                    unlockedAt: this.dateService.toISO(event.unlockedAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.DELETION_SCHEDULED)
    async handleTenantDeletionScheduledEvent(event: TenantDeletionScheduledEvent): Promise<void> {
        this.logger.log(`Handling tenant.deletion-scheduled event`, {
            tenantId: event.tenantId,
            scheduledAt: event.scheduledAt,
            executionDate: event.executionDate
        });

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    scheduledAt: this.dateService.toISO(event.scheduledAt),
                    executionDate: this.dateService.toISO(event.executionDate),
                    reason: event.reason
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );

        // Schedule deletion job
        const delay = this.dateService.diff(event.executionDate, new Date(), 'milliseconds');
        await this.bullJobsService.addDelayedJob<TenantDeletionJobData>(
            TENANT_DELETION_QUEUE,
            'execute-deletion',
            {
                tenantId: event.tenantId,
                scheduledAt: event.scheduledAt,
                reason: event.reason
            },
            Math.max(0, delay),
            {
                jobId: `deletion-${event.tenantId}`
            }
        );
    }

    @OnEvent(TenantEvents.DELETION_CANCELLED)
    async handleTenantDeletionCancelledEvent(event: TenantDeletionCancelledEvent): Promise<void> {
        this.logger.log(`Handling tenant.deletion-cancelled event`, {
            tenantId: event.tenantId
        });

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    cancelledAt: this.dateService.toISO(event.cancelledAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );

        // Cancel scheduled deletion job
        const jobId = `deletion-${event.tenantId}`;
        await this.bullJobsService.removeJob(TENANT_DELETION_QUEUE, jobId);
        this.logger.log(`Cancelled deletion job for tenant ${event.tenantId}`);
    }

    @OnEvent(TenantEvents.DELETED)
    async handleTenantDeletedEvent(event: TenantDeletedEvent): Promise<void> {
        this.logger.log(`Handling tenant.deleted event`, {
            tenantId: event.tenantId,
            name: event.name,
            slug: event.slug
        });

        // Publish SNS Event for cleanup by other services
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    name: event.name,
                    slug: event.slug
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );

        // Cleanup Keto relations
        const ketoRelations = await this.queryKetoRelationsForTenant(event.tenantId);
        for (const relation of ketoRelations) {
            await this.ketoService.deleteTuple(relation);
        }
        this.logger.log(`Cleaned up ${ketoRelations.length} Keto relations`, {
            tenantId: event.tenantId
        });
    }

    @OnEvent(TenantEvents.OWNERSHIP_TRANSFERRED)
    async handleTenantOwnershipTransferredEvent(event: TenantOwnershipTransferredEvent): Promise<void> {
        this.logger.log(`Handling tenant.ownership-transferred event`, {
            tenantId: event.tenantId,
            oldOwnerId: event.oldOwnerId,
            newOwnerId: event.newOwnerId
        });

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    oldOwnerId: event.oldOwnerId,
                    newOwnerId: event.newOwnerId,
                    transferredAt: this.dateService.toISO(event.transferredAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    @OnEvent(TenantEvents.DOMAIN_VERIFIED)
    async handleTenantDomainVerifiedEvent(event: TenantDomainVerifiedEvent): Promise<void> {
        this.logger.log(`Handling tenant.domain-verified event`, {
            tenantId: event.tenantId,
            domain: event.domain
        });

        // Provision custom domain
        this.domainProvisioningService.provisionDomain(event.tenantId, event.domain);

        // Publish SNS Event
        await this.sns.publish(
            TENANT_EVENTS_TOPIC,
            event.eventType,
            {
                eventId: event.eventId,
                data: {
                    tenantId: event.tenantId,
                    domain: event.domain,
                    verifiedAt: this.dateService.toISO(event.verifiedAt)
                },
                timestamp: this.dateService.toISO(event.occurredAt)
            },
            {
                messageGroupId: event.tenantId,
                messageDeduplicationId: event.eventId
            }
        );
    }

    /**
     * Query all Keto relations for a tenant
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
}
