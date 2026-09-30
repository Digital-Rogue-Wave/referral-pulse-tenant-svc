import { Module } from '@nestjs/common';

import { PlanLimitModule } from '@app/features/billing/plan-limit.module';

import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';

@Module({
    imports: [PlanLimitModule],
    controllers: [ApiKeyController],
    providers: [ApiKeyService],
    exports: [ApiKeyService]
})
export class ApiKeyModule {}
