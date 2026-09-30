import { mock, MockProxy } from 'jest-mock-extended';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { DomainProvisioningService } from '../../dns/domain-provisioning.service';

import { TenantListener } from './tenant.listener';
import { TenantDomainVerifiedEvent } from '@domains/tenant/events/tenant.events';

describe('TenantListener — in-process side effects of tenant lifecycle events', () => {
    let listener: TenantListener;
    let domains: MockProxy<DomainProvisioningService>;
    const tenantId = 'tenant-123';

    beforeEach(() => {
        domains = mock<DomainProvisioningService>();
        listener = new TenantListener(domains, mock<AppLoggerService>());
    });

    it('provisions a custom domain once it is verified', () => {
        listener.handleTenantDomainVerifiedEvent(new TenantDomainVerifiedEvent(tenantId, tenantId, 'refer.acme.io', new Date()));
        expect(domains.provisionDomain).toHaveBeenCalledWith(tenantId, 'refer.acme.io');
    });
});
