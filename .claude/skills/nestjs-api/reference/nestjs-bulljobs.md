# BullMQ Background Jobs & Cron Pattern

Background job processing and cron scheduling using BullMQ with Redis.

## Architecture

The app runs in two modes controlled by `APP_MODE` env var:

- **Web mode** (default) — HTTP server, enqueues jobs via `BullJobsService`
- **Worker mode** (`APP_MODE=worker`) — BullMQ workers process jobs, repeatable jobs are scheduled on startup

Worker mode is deployed as a separate K8s Deployment (`worker-deployment.yaml`).

```
Web Pod                              Worker Pod (APP_MODE=worker)
┌────────────────────┐               ┌──────────────────────────┐
│ Controller/Service │               │ QueueService (OnModuleInit)│
│        ↓           │               │   → addRepeatingJob()     │
│ BullJobsService    │               │                           │
│   .addJob()        │──── Redis ───→│ Processor                 │
│   .addDelayedJob() │               │   extends BaseWorkerService│
└────────────────────┘               │   → processJob(job)       │
                                     │        ↓                  │
                                     │ Domain Service            │
                                     │   (business logic)        │
                                     └──────────────────────────┘
```

## Common Module (`@common/bulljobs`)

### BullJobsService

Queue management — add jobs, get status, clean queues.

```typescript
import { BullJobsService } from '@common/bulljobs';

// One-off job
await this.bullJobsService.addJob('email-queue', 'send-welcome', {
    tenantId,
    email: 'user@example.com',
});

// Delayed job (execute in 1 hour)
await this.bullJobsService.addDelayedJob('reminder-queue', 'send-reminder', data, 3600000);

// Repeatable job (cron pattern)
await this.bullJobsService.addRepeatingJob('report-queue', 'daily-report', data, {
    pattern: '0 0 * * *', // Every day at midnight
});
```

### BaseWorkerService

Abstract base class for job processors. Handles worker lifecycle, tracing, metrics, and error handling.

```typescript
import { BaseWorkerService, BullJobsConnectionFactory } from '@common/bulljobs';

@Injectable()
export class MyProcessor extends BaseWorkerService<IMyJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly myService: MyDomainService,
    ) {
        super('my-queue', connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    protected async processJob(job: Job<IMyJobData>): Promise<IJobResult> {
        switch (job.name) {
            case 'do-something':
                await this.myService.doSomething();
                break;
            default:
                return { success: false, error: `Unknown job: ${job.name}` };
        }
        return { success: true };
    }
}
```

Key behaviors of `BaseWorkerService`:
- Only initializes the BullMQ Worker when `app.isWorker === true`
- Handles tenant context restoration from job data
- Records metrics and tracing for each job
- Retries with exponential backoff (3 attempts by default)
- Marks validation/auth errors as `UnrecoverableError` (no retry)

### BullJobsConnectionFactory

Creates Redis connection options for BullMQ queues/workers. Supports IAM auth and cluster mode.

## Feature Pattern: QueueService + Processor + Domain Services

### 1. QueueService — Schedules Repeatable Jobs

Runs `onModuleInit` in worker mode only. Registers BullMQ repeatable jobs with cron patterns.

```typescript
// src/features/billing/billing-queue.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BILLING_USAGE_QUEUE, MONTHLY_USAGE_RESET_JOB, DAILY_USAGE_SNAPSHOT_JOB } from '@app/types';
import type { ISystemJobData } from '@app/types';
import { BullJobsService } from '@common/bulljobs';
import { AppLoggerService } from '@common/logging/app-logger.service';
import type { AllConfigType } from '@config/config.type';

const SYSTEM_JOB_DATA: ISystemJobData = { tenantId: 'system' };

@Injectable()
export class BillingUsageQueueService implements OnModuleInit {
    constructor(
        private readonly bullJobsService: BullJobsService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(BillingUsageQueueService.name);
    }

    async onModuleInit(): Promise<void> {
        const isWorker = this.configService.get<boolean>('app.isWorker', { infer: true });

        if (isWorker) {
            await this.scheduleRepeatableJobs();
        }
    }

    private async scheduleRepeatableJobs(): Promise<void> {
        // Monthly usage reset: 1st of each month at midnight
        await this.bullJobsService.addRepeatingJob(BILLING_USAGE_QUEUE, MONTHLY_USAGE_RESET_JOB, SYSTEM_JOB_DATA, {
            pattern: '0 0 1 * *',
        });

        // Daily usage snapshot: every day at midnight
        await this.bullJobsService.addRepeatingJob(BILLING_USAGE_QUEUE, DAILY_USAGE_SNAPSHOT_JOB, SYSTEM_JOB_DATA, {
            pattern: '0 0 * * *',
        });
    }
}
```

### 2. Processor — Dispatches Jobs to Domain Services

Extends `BaseWorkerService`, routes job names to domain service methods.

```typescript
// src/features/billing/processors/billing-usage.processor.ts
@Injectable()
export class BillingUsageProcessor extends BaseWorkerService<IBillingJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly monthlyResetService: MonthlyUsageResetService,
        private readonly dailySnapshotService: DailyUsageCalculator,
    ) {
        super(BILLING_USAGE_QUEUE, connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    protected async processJob(job: Job<IBillingJobData>): Promise<IJobResult> {
        switch (job.name) {
            case MONTHLY_USAGE_RESET_JOB:
                await this.monthlyResetService.runMonthlyReset();
                break;
            case DAILY_USAGE_SNAPSHOT_JOB:
                await this.dailySnapshotService.runDailySnapshot();
                break;
            default:
                return { success: false, error: `Unknown job: ${job.name}` };
        }
        return { success: true };
    }
}
```

### 3. Domain Services — Business Logic

Plain `@Injectable()` services with no BullMQ awareness.

```typescript
// src/features/billing/monthly-usage-reset.service.ts
@Injectable()
export class MonthlyUsageResetService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
    ) {}

    async runMonthlyReset(): Promise<void> {
        // Pure business logic — no BullMQ, no cron awareness
    }
}
```

### 4. Module Registration

```typescript
@Module({
    providers: [
        BillingUsageQueueService,   // Schedules repeatable jobs
        BillingUsageProcessor,       // Processes jobs
        MonthlyUsageResetService,    // Domain logic
        DailyUsageCalculator,        // Domain logic
    ],
})
export class BillingModule {}
```

## Job Types

Define job data interfaces and constants in `src/types/app.type.ts`:

```typescript
export const BILLING_USAGE_QUEUE = 'billing-usage-queue';
export const MONTHLY_USAGE_RESET_JOB = 'monthly-usage-reset';
export const DAILY_USAGE_SNAPSHOT_JOB = 'daily-usage-snapshot';

export interface IBaseJobData {
    tenantId: string;
    userId?: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
}

export interface ISystemJobData extends IBaseJobData {
    tenantId: 'system';
}

export interface IBillingJobData extends IBaseJobData {
    // Add billing-specific fields as needed
}
```

## K8s Deployment

Worker runs as a separate Deployment with `APP_MODE=worker`:

```yaml
# deployment/helm/templates/worker-deployment.yaml
containers:
  - name: worker
    env:
      - name: APP_MODE
        value: "worker"
    # Same image, same envFrom as web pod
    # No ports, no ingress — just processes jobs
```

## Rules

- **No `@nestjs/schedule`** — use BullMQ repeatable jobs instead
- **No `@Cron()` decorators** — cron patterns go in QueueService
- **QueueService** only runs in worker mode (`isWorker` guard)
- **Processor** only dispatches — domain logic stays in domain services
- **Domain services** have no BullMQ awareness — testable in isolation
- **Job constants** (queue names, job names) live in `src/types/app.type.ts`
- **System jobs** use `{ tenantId: 'system' }` as job data