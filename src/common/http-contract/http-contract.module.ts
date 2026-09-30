import { Module } from '@nestjs/common';

import { IdempotencyKeySweeperWorker } from './idempotency-key-sweeper.worker';

/** API Contract v1.3 §1 plumbing that needs providers (the interceptors are registered in AppModule). */
@Module({
    providers: [IdempotencyKeySweeperWorker]
})
export class HttpContractModule {}
