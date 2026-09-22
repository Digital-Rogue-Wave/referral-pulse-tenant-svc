import { Module } from '@nestjs/common';

import { BillingModule } from '@app/features/billing/billing.module';

import { TenantDeletionSweeperWorker } from './tenant-deletion-sweeper.worker';
import { TenantDeletionService } from './tenant-deletion.service';

/** The tenant deletion saga. Separate from TenantModule because it needs billing, which depends on tenants. */
@Module({
    imports: [BillingModule],
    providers: [TenantDeletionService, TenantDeletionSweeperWorker]
})
export class TenantDeletionModule {}
