import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../tenant/tenant.entity';
import { ReservedSubdomainEntity } from './reserved-subdomain.entity';
import { DnsVerificationService } from './dns-verification.service';
import { DomainProvisioningService } from './domain-provisioning.service';
import { SubdomainService } from './subdomain.service';

@Module({
    imports: [TypeOrmModule.forFeature([ReservedSubdomainEntity, TenantEntity])],
    providers: [DnsVerificationService, DomainProvisioningService, SubdomainService],
    exports: [DnsVerificationService, DomainProvisioningService, SubdomainService]
})
export class DnsModule {}
