import { Module } from '@nestjs/common';

import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyListener } from './listeners/api-key.listener';

@Module({
    controllers: [ApiKeyController],
    providers: [ApiKeyService, ApiKeyListener],
    exports: [ApiKeyService],
})
export class ApiKeyModule {}
