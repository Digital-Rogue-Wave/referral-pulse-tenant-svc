import { Module } from '@nestjs/common';

import { IdempotencyService } from './idempotency.service';

/** Message-level dedup for queue consumers and provider web hooks (Redis, 24 h). */
@Module({
    providers: [IdempotencyService],
    exports: [IdempotencyService]
})
export class IdempotencyModule {}
