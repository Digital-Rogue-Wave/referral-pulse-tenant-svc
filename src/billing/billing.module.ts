import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingEntity } from './billing.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { BillingListener } from './listeners/billing.listener';

@Module({
    imports: [TypeOrmModule.forFeature([BillingEntity])],
    controllers: [BillingController],
    providers: [BillingService, StripeService, BillingListener],
    exports: [BillingService]
})
export class BillingModule {}
