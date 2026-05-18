# NestJS Resilience — Request Context & Correlation

Request context propagation using AsyncLocalStorage for NestJS 11.x. For circuit breaker and database fallback patterns, see `nestjs-resilience-circuit-breaker.md`.

## 1. Request Context (AsyncLocalStorage)

Propagates request context through the entire call chain using AsyncLocalStorage, enabling access to correlation ID, user info, and other request metadata from any point in the application without passing through parameters.

### Implementation

```typescript
/**
 * Request Context Service
 *
 * Propagates request context through the entire call chain using AsyncLocalStorage.
 * Enables access to correlation ID, user info, and other request metadata
 * from any point in the application without passing through parameters.
 */

import { AsyncLocalStorage } from 'async_hooks';

export type AlsRequestContext = {
  requestId: string;
  tenantId: string;
  userId: string;
  correlationId?: string;
  idempotencyKey?: string;
  ip?: string;
  userAgent?: string;
  route?: string;
  method?: string;
  traceId?: string;
  spanId?: string;
  startTime?: number;
  metadata?: Record<string, unknown>;
};

```

### Interceptor

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Request } from 'express';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ulid } from 'ulid';

import { alsStorage } from '@app/common/tenant-aware/tenant-context.service';
import type { IAuthenticatedUser, IExtendedRequest, MaybeType, RequestContext } from '@app/types';
import { DateService } from '@common/helper/date.service';

type RequestWithUser = Request & IExtendedRequest;

/**
 * Interceptor that initializes AsyncLocalStorage context for each request.
 * Populates context from request headers and JWT claims (if authenticated).
 */
@Injectable()
export class AlsAuthInterceptor implements NestInterceptor {
    constructor(private readonly dateService: DateService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const request = context.switchToHttp().getRequest<RequestWithUser>();
        const user = request.user as MaybeType<IAuthenticatedUser>;

        // Build the request context
        const requestContext = this.buildRequestContext(request, user);

        // Run the request handler within the ALS context
        return from(
            alsStorage.run(requestContext, () => {
                return new Promise<Observable<unknown>>((resolve) => {
                    resolve(next.handle());
                });
            })
        ).pipe(switchMap((obs) => obs));
    }

    private buildRequestContext(request: RequestWithUser, user: MaybeType<IAuthenticatedUser>): RequestContext {
        const requestId = this.getHeader(request, 'x-request-id') || request.requestId || ulid();
        const correlationId = this.getHeader(request, 'x-correlation-id') || request.correlationId || ulid();
        const { traceId, spanId } = this.extractTraceContext(request);

        const ctx: RequestContext = {
            requestId,
            correlationId,
            tenantId: user?.tenantId || this.getHeader(request, 'x-tenant-id') || request.tenantId || '',
            userId: user?.userId || this.getHeader(request, 'x-user-id') || request.userId || '',
            idempotencyKey: this.getHeader(request, 'x-idempotency-key') || request.idempotencyKey,
            ip: this.extractIp(request),
            userAgent: request.headers['user-agent'],
            route: request.route?.path || request.path,
            method: request.method,
            startTime: this.dateService.now(),
            traceId,
            spanId,
            metadata: {}
        };

        // Add user metadata if authenticated
        if (user) {
            this.populateUserMetadata(ctx, user, request);
        }

        return ctx;
    }

    private populateUserMetadata(ctx: RequestContext, user: IAuthenticatedUser, request: RequestWithUser): void {
        const authHeader = request.headers['authorization'];
        if (authHeader) {
            ctx.metadata = { ...ctx.metadata, authHeader };
        }
        if (user.metadata) ctx.metadata = { ...ctx.metadata, ...user.metadata };
        if (user.roles) ctx.metadata = { ...ctx.metadata, roles: user.roles };
        if (user.permissions) ctx.metadata = { ...ctx.metadata, permissions: user.permissions };
        if (user.email) ctx.metadata = { ...ctx.metadata, email: user.email };
    }

    private getHeader(request: Request, name: string): string | undefined {
        const val = request.headers[name] || request.headers[name.toLowerCase()];
        return Array.isArray(val) ? val[0] : (val as string | undefined);
    }

    private extractIp(request: Request): string | undefined {
        const forwarded = request.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim();
        return request.ip || request.socket.remoteAddress;
    }

    private extractTraceContext(request: Request): { traceId?: string; spanId?: string } {
        const traceparent = request.headers['traceparent'] as string;
        if (traceparent) {
            const parts = traceparent.split('-');
            if (parts.length === 4) return { traceId: parts[1], spanId: parts[2] };
        }
        return {
            traceId: request.headers['x-b3-traceid'] as string,
            spanId: request.headers['x-b3-spanid'] as string
        };
    }
}
```

### Interceptor Registration

```typescript
@Module({
  imports: [
    ...
  ],
  providers: [
    ...
    { provide: APP_INTERCEPTOR, useClass: AlsAuthInterceptor }
  ]
})
```

### Usage in Services

```typescript

async withTenantContext<T, R>(envelope: IMessageEnvelope<T>, handler: (payload: T, envelope: IMessageEnvelope<T>) => Promise<R>): Promise<R> {
  const context = this.extractAlsContext(envelope);
  return this.tenantContext.runWithContext(context, async () => {
    return handler(envelope.payload, envelope);
  });
}

const tenantId = this.tenantContext.getTenantId();
```

## 2. Best Practices

### Request Context
- `AlsAuthInterceptor` initializes ALS context for every request (registered globally via `APP_INTERCEPTOR`)
- Use `tenantContext.getCorrelationId()` in all log statements for distributed tracing
- Store tenant/user info in context for multi-tenant applications
- Avoid storing large objects in metadata to prevent memory overhead
