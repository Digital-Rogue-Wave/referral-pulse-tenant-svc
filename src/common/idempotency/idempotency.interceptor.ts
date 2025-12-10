import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisKeyBuilder } from '@mod/common/aws-redis/redis-key.builder';
import { IDEMPOTENCY_KEY, IdempotencyOptions } from './idempotency.decorator';
import type { Request, Response } from 'express';
import { CachedResponse } from '@mod/types/app.interface';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    constructor(
        private readonly redis: RedisService,
        private readonly keys: RedisKeyBuilder,
        private readonly reflector: Reflector
    ) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        if (context.getType() !== 'http') {
            return next.handle();
        }

        const options = this.reflector.get<IdempotencyOptions>(IDEMPOTENCY_KEY, context.getHandler());

        if (!options) {
            return next.handle();
        }

        const req = context.switchToHttp().getRequest<Request>();
        const res = context.switchToHttp().getResponse<Response>();

        const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

        if (req.method === 'GET' || !idempotencyKey) {
            return next.handle();
        }

        const prefix = options.keyPrefix ?? 'idempotency';
        const key = this.keys.build(prefix, idempotencyKey);
        const ttl = options.ttl ?? 86400;

        // Use raw Redis methods to avoid type constraints
        const cachedRaw = await this.redis.get(key);

        if (cachedRaw) {
            try {
                const cached: CachedResponse = JSON.parse(cachedRaw);
                res.status(cached.statusCode);
                return of(cached.body);
            } catch {
                // Corrupted cache - continue with normal flow
            }
        }

        return next.handle().pipe(
            tap(async (responseBody) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    const toCache: CachedResponse = {
                        statusCode: res.statusCode,
                        body: responseBody
                    };
                    await this.redis.set(key, JSON.stringify(toCache), ttl);
                }
            })
        );
    }
}
