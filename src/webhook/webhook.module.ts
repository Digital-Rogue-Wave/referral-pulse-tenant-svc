import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhooksController } from './webhooks.controller';
import { TenantModule } from '../tenant/tenant.module';
import { BillingModule } from '../billing/billing.module';

@Module({
    imports: [TenantModule, BillingModule],
    controllers: [WebhookController, WebhooksController]
})
export class WebhookModule {}
