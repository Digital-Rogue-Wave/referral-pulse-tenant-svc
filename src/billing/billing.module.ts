import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingEntity } from './billing.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { BillingListener } from './listeners/billing.listener';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';

@Module({
    imports: [TenantAwareRepositoryModule.forEntities([BillingEntity])],
    controllers: [BillingController],
    providers: [BillingService, StripeService, BillingListener],
    exports: [BillingService]
})
export class BillingModule {}
