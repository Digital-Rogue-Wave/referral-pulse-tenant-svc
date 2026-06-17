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
 *
 * This interceptor:
 * 1. Creates a new ALS context for each request
 * 2. Extracts request metadata from headers (requestId, correlationId, etc.)
 * 3. Populates tenant/user context from JWT claims if authenticated
 * 4. Extracts distributed tracing context (W3C Trace Context / B3)
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

    /**
     * Build the full request context from request and user
     */
    private buildRequestContext(request: RequestWithUser, user: MaybeType<IAuthenticatedUser>): RequestContext {
        const requestId = this.getHeader(request, 'x-request-id') || request.requestId || ulid();
        const correlationId = this.getHeader(request, 'x-correlation-id') || request.correlationId || ulid();

        // Extract trace context
        const { traceId, spanId } = this.extractTraceContext(request);

        // Build base context from headers
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

    /**
     * Populate metadata from authenticated user
     */
    private populateUserMetadata(ctx: RequestContext, user: IAuthenticatedUser, request: RequestWithUser): void {
        // Store Authorization header for internal service-to-service calls
        const authHeader = request.headers['authorization'];
        if (authHeader) {
            ctx.metadata = { ...ctx.metadata, authHeader };
        }

        if (user.metadata) {
            ctx.metadata = { ...ctx.metadata, ...user.metadata };
        }

        if (user.roles) {
            ctx.metadata = { ...ctx.metadata, roles: user.roles };
        }

        if (user.permissions) {
            ctx.metadata = { ...ctx.metadata, permissions: user.permissions };
        }

        if (user.email) {
            ctx.metadata = { ...ctx.metadata, email: user.email };
        }
    }

    /**
     * Get header value (case-insensitive)
     */
    private getHeader(request: Request, name: string): string | undefined {
        const val = request.headers[name] || request.headers[name.toLowerCase()];
        if (Array.isArray(val)) {
            return val[0];
        }
        return val as string | undefined;
    }

    /**
     * Extract client IP from request
     */
    private extractIp(request: Request): string | undefined {
        const forwarded = request.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            const firstIp = forwarded.split(',')[0];
            return firstIp?.trim();
        }
        return request.ip || request.socket.remoteAddress;
    }

    /**
     * Extract distributed trace context from incoming HTTP request headers
     * Supports W3C Trace Context (traceparent) and B3 propagation (X-B3-*)
     */
    private extractTraceContext(request: Request): {
        traceId?: string;
        spanId?: string;
    } {
        // Try W3C Trace Context first (standard)
        const traceparent = request.headers['traceparent'] as string;
        if (traceparent) {
            // Format: 00-{trace-id}-{span-id}-{trace-flags}
            const parts = traceparent.split('-');
            if (parts.length === 4) {
                return { traceId: parts[1], spanId: parts[2] };
            }
        }

        // Fall back to B3 propagation headers (for compatibility)
        return {
            traceId: request.headers['x-b3-traceid'] as string,
            spanId: request.headers['x-b3-spanid'] as string
        };
    }
}
