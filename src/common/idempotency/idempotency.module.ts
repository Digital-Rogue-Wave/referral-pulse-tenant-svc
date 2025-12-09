import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from '@mod/common/idempotency/idempotency.interceptor';
import { RedisModule } from '@mod/common/aws-redis/redis.module';
import { EventIdempotencyService } from '@mod/common/idempotency/event-idempotency.service';

@Global()
@Module({
    imports: [RedisModule],
    providers: [
        {
            provide: APP_INTERCEPTOR,
            useClass: IdempotencyInterceptor,
        },
        EventIdempotencyService
    ],
    exports: [EventIdempotencyService]
})
export class IdempotencyModule {}
