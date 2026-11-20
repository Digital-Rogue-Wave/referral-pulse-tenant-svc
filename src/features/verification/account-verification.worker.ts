import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NativeConnection, Worker } from '@temporalio/worker';

import { AppLoggerService } from '@common/logging/app-logger.service';
import type { AllConfigType } from '@config/config.type';

import { AccountVerificationActivities } from './account-verification.activities';

/**
 * Runs `account_verification` (v5.2 Architecture §2.1) in worker mode only (`APP_MODE=worker`), on tenant-service's own
 * task queue — the same split as its BullMQ workers.
 */
@Injectable()
export class AccountVerificationWorker implements OnModuleInit, OnModuleDestroy {
    private worker: Worker | null = null;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly activities: AccountVerificationActivities,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(AccountVerificationWorker.name);
    }

    onModuleInit(): void {
        if (process.env.APP_MODE?.toLowerCase() !== 'worker' || process.env.NODE_ENV === 'test') {
            return;
        }
        this.run().catch((error: Error) => this.logger.error('Temporal worker stopped', error.stack));
    }

    onModuleDestroy(): void {
        // shutdown() throws unless the worker is RUNNING (a SIGTERM may already have moved it to DRAINING).
        if (this.worker?.getState() === 'RUNNING') {
            this.worker.shutdown();
        }
    }

    private async run(): Promise<void> {
        const { address, namespace, taskQueue } = this.configService.getOrThrow('temporal', { infer: true });
        this.worker = await Worker.create({
            workflowsPath: require.resolve('./workflows'),
            activities: { reportSlaBreach: this.activities.reportSlaBreach.bind(this.activities) },
            taskQueue,
            namespace,
            connection: await NativeConnection.connect({ address })
        });
        this.logger.log(`Temporal worker started on ${taskQueue}`);
        await this.worker.run();
    }
}
