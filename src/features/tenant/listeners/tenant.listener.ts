import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AppLoggerService } from '@common/logging/app-logger.service';

import { DomainProvisioningService } from '../../dns/domain-provisioning.service';

import { TenantDomainVerifiedEvent, TenantEvents } from '@domains/tenant/events/tenant.events';

/**
 * In-process side effects of tenant lifecycle events. Publishing to the bus is not done here: every
 * published tenant event goes through the transactional outbox (EventOutboxWriter → event_outbox →
 * EventOutboxRelayWorker → SNS `tenant-events`). Scheduled deletions are executed by the deletion sweeper
 * from `tenants.deletion_due_at`, not by a job queued here.
 */
@Injectable()
export class TenantListener {
    constructor(
        private readonly domainProvisioningService: DomainProvisioningService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TenantListener.name);
    }

    @OnEvent(TenantEvents.DOMAIN_VERIFIED)
    handleTenantDomainVerifiedEvent(event: TenantDomainVerifiedEvent): void {
        this.domainProvisioningService.provisionDomain(event.tenantId, event.domain);
    }
}
