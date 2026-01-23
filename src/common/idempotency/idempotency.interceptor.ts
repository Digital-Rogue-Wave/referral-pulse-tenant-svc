import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { IDEMPOTENCY_KEY, IdempotencyDecoratorOptions } from './idempotency.decorator';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKeyGenerator } from './idempotency-key.generator';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { IdempotencyScope } from '@app/types';

/**
 * HTTP Idempotency Interceptor
 *
 * Enforces idempotency for HTTP endpoints decorated with @Idempotent()
 *
 * How it works:
 * 1. Checks if handler has @Idempotent() decorator
 * 2. Extracts idempotency key from request header (default: "Idempotency-Key")
 * 3. Checks if request was already processed (via IdempotencyService)
 * 4. If duplicate → returns cached response
 * 5. If new → executes handler and caches response
 *
 * Client Usage:
 * ```bash
 * curl -X POST /api/v1/totos \
 *   -H "Idempotency-Key: user-action-12345" \
 *   -H "x-tenant-id: tenant-123" \
 *   -d '{"name": "My Toto"}'
 * ```
 *
 * Response Headers:
 * - X-Idempotency-Replayed: "true" (if cached response returned)
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor<unknown, unknown> {
    constructor(
        private readonly reflector: Reflector,
        private readonly idempotencyService: IdempotencyService,
        private readonly keyGenerator: IdempotencyKeyGenerator,
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(IdempotencyInterceptor.name);
    }

    intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
        // Only handle HTTP requests
        if (context.getType() !== 'http') {
            return next.handle();
        }

        // Get @Idempotent() decorator metadata
        const options = this.reflector.get<IdempotencyDecoratorOptions>(
            IDEMPOTENCY_KEY,
            context.getHandler(),
        );

        // If no decorator, skip idempotency
        if (!options) {
            return next.handle();
        }

        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse<Response>();
        const headerName = (options.headerName || 'Idempotency-Key').toLowerCase();

        // Extract idempotency key from header
        const customKey = request.headers[headerName] as string | undefined;

        // If idempotency is required but no key provided, reject
        if (options.required && !customKey) {
            throw new BadRequestException(
                `${options.headerName || 'Idempotency-Key'} header is required for this endpoint`,
            );
        }

        // If no key provided and not required, skip idempotency
        if (!customKey) {
            this.logger.debug('No idempotency key provided, skipping idempotency check');
            return next.handle();
        }

        // Build scoped idempotency key
        const tenantId = this.tenantContext.get('tenantId');
        const userId = this.tenantContext.get('userId');
        const scopedKey = this.buildScopedKey(customKey, options.scope || IdempotencyScope.Global, tenantId, userId);

        this.logger.debug('Processing request with idempotency', {
            customKey,
            scopedKey,
            scope: options.scope,
            method: request.method,
            path: request.path,
        });

        // Execute with idempotency protection
        return from(
            this.idempotencyService.executeOnce<unknown>(
                scopedKey,
                () => lastValueFrom(next.handle()),
                {
                    ttl: options.ttl,
                    storeResponse: options.storeResponse,
                },
            ),
        ).pipe(
            switchMap(({ result, isDuplicate }) => {
                if (isDuplicate) {
                    response.setHeader('X-Idempotency-Replayed', 'true');
                    this.logger.log('Returned cached response for duplicate request', {
                        scopedKey,
                        method: request.method,
                        path: request.path,
                    });
                } else {
                    this.logger.log('Processed and cached new request', {
                        scopedKey,
                        method: request.method,
                        path: request.path,
                    });
                }

                return from([result]);
            }),
        );
    }

    /**
     * Build scoped idempotency key based on scope configuration
     */
    private buildScopedKey(
        customKey: string,
        scope: IdempotencyScope,
        tenantId: string | undefined,
        userId: string | undefined,
    ): string {
        switch (scope) {
            case IdempotencyScope.Tenant:
                if (!tenantId) {
                    this.logger.warn('Tenant scope requested but no tenantId in context, falling back to global');
                    return customKey;
                }
                return `tenant:${tenantId}:${customKey}`;

            case IdempotencyScope.User:
                if (!userId) {
                    this.logger.warn('User scope requested but no userId in context, falling back to global');
                    return customKey;
                }
                return `user:${userId}:${customKey}`;

            case IdempotencyScope.Custom:
                // For custom scope, tenant and user can both be included
                const parts: string[] = [];
                if (tenantId) parts.push(`tenant:${tenantId}`);
                if (userId) parts.push(`user:${userId}`);
                parts.push(customKey);
                return parts.join(':');

            case IdempotencyScope.Global:
            default:
                return customKey;
        }
    }
}