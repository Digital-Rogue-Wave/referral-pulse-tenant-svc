import { Module } from '@nestjs/common';

import { RetentionSweeperWorker } from './retention-sweeper.worker';

/** Nightly deletion of data past its retention window (audit trail, ended invitations, delivered side effects). */
@Module({
    providers: [RetentionSweeperWorker]
})
export class RetentionModule {}
