import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { TenantModule } from '../tenant/tenant.module';

@Module({
    imports: [TenantModule],
    controllers: [WebhookController]
})
export class WebhookModule {}
