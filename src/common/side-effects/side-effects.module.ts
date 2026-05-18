import { Module, DynamicModule, Global } from '@nestjs/common';

import { OutboxWorkerService } from './outbox-worker.service';
import { SideEffectService } from './side-effect.service';
import { BullJobsModule, BullJobsService } from '../bulljobs';
import { LoggingModule } from '../logging/logging.module';
import { TenantAwareModule } from '../tenant-aware/tenant-aware.module';

export interface SideEffectsModuleOptions {
    /**
     * Enable worker mode (runs BullMQ workers)
     * Set to false in web pods, true in worker pods
     */
    enableWorker?: boolean;
}

/**
 * Side Effects Module (Outbox Pattern with BullMQ)
 *
 * Usage:
 * - Automatically detects APP_MODE environment variable via BaseWorkerService
 * - All pods can create side effects (SideEffectService)
 * - Only worker pods process the jobs (OutboxWorkerService)
 */
@Global()
@Module({
    imports: [BullJobsModule, LoggingModule, TenantAwareModule],
    providers: [BullJobsService, SideEffectService, OutboxWorkerService],
    exports: [SideEffectService]
})
export class SideEffectsModule {
    /**
     * Legacy support for forRoot, returns the module itself
     */
    static forRoot(options: SideEffectsModuleOptions = {}): DynamicModule {
        return {
            module: SideEffectsModule
        };
    }
}
