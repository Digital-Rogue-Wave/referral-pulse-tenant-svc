import { Module, DynamicModule, Type, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SideEffectOutboxEntity } from './side-effect-outbox.entity';
import { SideEffectService, BULLJOBS_SERVICE } from './side-effect.service';
import { OutboxWorkerService } from './outbox-worker.service';
import { MessagingModule } from '@app/common/messaging/messaging.module';
import { LoggingModule } from '@app/common/logging/logging.module';
import { TenantModule } from '@app/common/tenant/tenant.module';
import { BullJobsModule, BullJobsService } from '@app/common/bulljobs';

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
 * - Web pods: SideEffectsModule.forRoot({ enableWorker: false })
 * - Worker pods: SideEffectsModule.forRoot({ enableWorker: true })
 *
 * Architecture:
 * - All pods can create side effects (writes to outbox DB + enqueues BullMQ job)
 * - Only worker pods process the jobs (OutboxWorkerService)
 * - BullMQ provides distributed processing, retries, and persistence
 *
 * Features:
 * - Transactional side effect storage (outbox pattern)
 * - BullMQ-based distributed processing (replaces cron)
 * - Automatic retries with exponential backoff
 * - Support for SQS, SNS, email, audit side effects
 * - Rate limiting and concurrency control
 */
@Module({})
export class SideEffectsModule {
    static forRoot(options: SideEffectsModuleOptions = {}): DynamicModule {
        const { enableWorker = false } = options;

        const providers: Provider[] = [
            // Provide BullJobsService to SideEffectService via injection token
            {
                provide: BULLJOBS_SERVICE,
                useExisting: BullJobsService,
            },
            SideEffectService,
        ];

        // Only register worker in worker mode
        if (enableWorker) {
            providers.push(OutboxWorkerService);
        }

        return {
            module: SideEffectsModule,
            imports: [
                // Register entity
                TypeOrmModule.forFeature([SideEffectOutboxEntity]),

                // BullMQ for job processing
                BullJobsModule,

                // Dependencies
                MessagingModule.forRoot(),
                LoggingModule,
                TenantModule,
            ],
            providers,
            exports: [SideEffectService], // Export only the service, not the worker
        };
    }
}