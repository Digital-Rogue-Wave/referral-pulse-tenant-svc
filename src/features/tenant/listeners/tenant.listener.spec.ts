import { mock, MockProxy } from 'jest-mock-extended';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { BullJobsService } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { TENANT_DELETION_QUEUE } from '@app/types';
import { DomainProvisioningService } from '../../dns/domain-provisioning.service';

import { TenantListener } from './tenant.listener';
import { TenantDeletionScheduledEvent, TenantDeletionCancelledEvent, TenantDomainVerifiedEvent } from '@domains/tenant/events/tenant.events';

describe('TenantListener — in-process side effects of tenant lifecycle events', () => {
    let listener: TenantListener;
    let bullJobs: MockProxy<BullJobsService>;
    let domains: MockProxy<DomainProvisioningService>;
    let dates: MockProxy<DateService>;
    const tenantId = 'tenant-123';

    beforeEach(() => {
        bullJobs = mock<BullJobsService>();
        domains = mock<DomainProvisioningService>();
        dates = mock<DateService>();
        listener = new TenantListener(bullJobs, domains, mock<AppLoggerService>(), dates);
    });

    it('schedules the deletion job for the execution date, keyed on the tenant so it can be cancelled', async () => {
        dates.diff.mockReturnValue(86_400_000);
        const scheduledAt = new Date();

        await listener.handleTenantDeletionScheduledEvent(
            new TenantDeletionScheduledEvent(tenantId, tenantId, scheduledAt, new Date(Date.now() + 86_400_000), 'closing')
        );

        expect(bullJobs.addDelayedJob).toHaveBeenCalledWith(
            TENANT_DELETION_QUEUE,
            'execute-deletion',
            { tenantId, scheduledAt, reason: 'closing' },
            86_400_000,
            { jobId: `deletion-${tenantId}` }
        );
    });

    it('never schedules in the past', async () => {
        dates.diff.mockReturnValue(-5000);
        await listener.handleTenantDeletionScheduledEvent(new TenantDeletionScheduledEvent(tenantId, tenantId, new Date(), new Date(), 'x'));
        expect(bullJobs.addDelayedJob.mock.calls[0]![3]).toBe(0);
    });

    it('removes the deletion job when the deletion is cancelled', async () => {
        await listener.handleTenantDeletionCancelledEvent(new TenantDeletionCancelledEvent(tenantId, tenantId, new Date()));
        expect(bullJobs.removeJob).toHaveBeenCalledWith(TENANT_DELETION_QUEUE, `deletion-${tenantId}`);
    });

    it('provisions a custom domain once it is verified', () => {
        listener.handleTenantDomainVerifiedEvent(new TenantDomainVerifiedEvent(tenantId, tenantId, 'refer.acme.io', new Date()));
        expect(domains.provisionDomain).toHaveBeenCalledWith(tenantId, 'refer.acme.io');
    });
});
