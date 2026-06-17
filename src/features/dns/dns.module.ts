import { Module } from '@nestjs/common';

import { DnsVerificationService } from './dns-verification.service';
import { DomainProvisioningService } from './domain-provisioning.service';
import { SubdomainService } from './subdomain.service';

@Module({
    providers: [DnsVerificationService, DomainProvisioningService, SubdomainService],
    exports: [DnsVerificationService, DomainProvisioningService, SubdomainService]
})
export class DnsModule {}
