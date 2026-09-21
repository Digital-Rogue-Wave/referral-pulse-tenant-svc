import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { BullJobsService } from '@common/bulljobs';
import { TENANT_DELETION_QUEUE, TenantDeletionJobData } from '@app/types';

import { DomainProvisioningService } from '../../dns/domain-provisioning.service';

import {
    TenantDeletionScheduledEvent,
    TenantDeletionCancelledEvent,
    TenantDomainVerifiedEvent,
    TenantEvents
} from '@domains/tenant/events/tenant.events';

/**
 * In-process side effects of tenant lifecycle events. Publishing to the bus is not done here: every
 * published tenant event goes through the transactional outbox (EventOutboxWriter → event_outbox →
 * EventOutboxRelayWorker → SNS `tenant-events`).
 */
@Injectable()
export class TenantListener {
    constructor(
        private readonly bullJobsService: BullJobsService,
        private readonly domainProvisioningService: DomainProvisioningService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService
    ) {
        this.logger.setContext(TenantListener.name);
    }

    @OnEvent(TenantEvents.DELETION_SCHEDULED)
    async handleTenantDeletionScheduledEvent(event: TenantDeletionScheduledEvent): Promise<void> {
        const delay = this.dateService.diff(event.executionDate, new Date(), 'milliseconds');
        await this.bullJobsService.addDelayedJob<TenantDeletionJobData>(
            TENANT_DELETION_QUEUE,
            'execute-deletion',
            { tenantId: event.tenantId, scheduledAt: event.scheduledAt, reason: event.reason },
            Math.max(0, delay),
            { jobId: `deletion-${event.tenantId}` }
        );
        this.logger.log('Tenant deletion job scheduled', { tenantId: event.tenantId, executionDate: event.executionDate });
    }

    @OnEvent(TenantEvents.DELETION_CANCELLED)
    async handleTenantDeletionCancelledEvent(event: TenantDeletionCancelledEvent): Promise<void> {
        await this.bullJobsService.removeJob(TENANT_DELETION_QUEUE, `deletion-${event.tenantId}`);
        this.logger.log('Tenant deletion job cancelled', { tenantId: event.tenantId });
    }

    @OnEvent(TenantEvents.DOMAIN_VERIFIED)
    handleTenantDomainVerifiedEvent(event: TenantDomainVerifiedEvent): void {
        this.domainProvisioningService.provisionDomain(event.tenantId, event.domain);
    }
}
