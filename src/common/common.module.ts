import { Module } from '@nestjs/common';
import { LoggingModule } from '@mod/common/logger/logging.module';
import { HttpClientsModule } from '@mod/common/http/http-clients.module';
import { RedisModule } from '@mod/common/aws-redis/redis.module';
import { HelperModule } from '@mod/common/helpers/helper.module';
import { S3Module } from '@mod/common/aws-s3/s3.module';
import { SqsMessagingModule } from '@mod/common/aws-sqs/sqs.module';
import { SnsModule } from '@mod/common/aws-sqs/sns.module';

import { TracingModule } from '@mod/common/tracing/tracing.module';
import { MonitoringModule } from '@mod/common/monitoring/monitoring.module';

import { IsNotUsedByOthers } from '@mod/common/validators/is-not-used-by-others';
import { IsNotExist } from '@mod/common/validators/is-not-exists.validator';
import { IsExist } from '@mod/common/validators/is-exists.validator';
import { IsDateGreaterThanNowValidator } from '@mod/common/validators/is-date-grater-than-now.validator';
import { EndLaterThanStartDateValidator } from '@mod/common/validators/end-later-than-start-date.validator';
import { CompareDateConstraint } from '@mod/common/validators/compare-date.validator';
import { IsGreaterThanOrEqualConstraint } from '@mod/common/validators/is.greater.than.or.equal.validator';
import { IdempotencyModule } from '@mod/common/idempotency/idempotency.module';
import { RequestIdMiddleware } from '@mod/common/middleware/request-id.middleware';
import { AuthModule } from '@mod/common/auth/auth.module';
import { ClientsModule } from '@mod/common/clients/clients.module';

@Module({
    imports: [
        LoggingModule,
        RedisModule,
        HelperModule,
        S3Module,
        SqsMessagingModule.register(),
        SnsModule,
        TracingModule.register(),
        MonitoringModule.register(),
        HttpClientsModule,
        IdempotencyModule,
        AuthModule,
        ClientsModule,
    ],
    providers: [
        IsNotUsedByOthers,
        IsNotExist,
        IsExist,
        IsDateGreaterThanNowValidator,
        EndLaterThanStartDateValidator,
        CompareDateConstraint,
        IsGreaterThanOrEqualConstraint,
        RequestIdMiddleware,
    ],
    exports: [
        IsNotUsedByOthers,
        IsNotExist,
        IsExist,
        IsDateGreaterThanNowValidator,
        EndLaterThanStartDateValidator,
        CompareDateConstraint,
        IsGreaterThanOrEqualConstraint,
        RedisModule,
        S3Module,
        SqsMessagingModule,
        SnsModule,
        TracingModule,
        MonitoringModule,
        HttpClientsModule,
        LoggingModule,
        IdempotencyModule,
        RequestIdMiddleware,
        AuthModule,
        HelperModule,
        ClientsModule,
    ],
})
export class CommonModule {}
