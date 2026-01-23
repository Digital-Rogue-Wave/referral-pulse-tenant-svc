import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { ulid } from 'ulid';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { DateService } from '@app/common/helper/date.service';
import { IAuthenticatedUser, MaybeType } from '@app/types';

/**
 * Interceptor to populate CLS (Continuation-Local Storage) context from authenticated user.
 * Runs after JWT authentication and sets tenant context for the request.
 */
@Injectable()
export class ClsAuthInterceptor implements NestInterceptor {
    constructor(
        private readonly tenantContext: ClsTenantContextService,
        private readonly dateService: DateService,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest<Request>();
        const user = request.user as MaybeType<IAuthenticatedUser>;

        if (user) {
            // Set tenant and user context from JWT claims
            this.tenantContext.set('tenantId', user.tenantId);
            this.tenantContext.set('userId', user.userId);

            // Store Authorization header for internal service-to-service calls
            const authHeader = request.headers['authorization'];
            if (authHeader) {
                this.tenantContext.setMetadata('authHeader', authHeader);
            }

            // Set request metadata
            this.tenantContext.set('requestId', request.headers['x-request-id'] as string || ulid());
            this.tenantContext.set('correlationId', request.headers['x-correlation-id'] as string || ulid());
            this.tenantContext.set('ip', this.extractIp(request));
            this.tenantContext.set('userAgent', request.headers['user-agent']);
            this.tenantContext.set('route', request.route?.path || request.path);
            this.tenantContext.set('method', request.method);
            this.tenantContext.set('startTime', this.dateService.now());

            // Extract and store distributed trace context from incoming request
            // OpenTelemetry auto-instrumentation handles span creation, but we store trace IDs in CLS for manual access
            this.extractTraceContext(request);

            // Store additional user metadata in CLS
            if (user.metadata) {
                Object.entries(user.metadata).forEach(([key, value]) => {
                    this.tenantContext.setMetadata(key, value);
                });
            }

            if (user.roles) {
                this.tenantContext.setMetadata('roles', user.roles);
            }

            if (user.permissions) {
                this.tenantContext.setMetadata('permissions', user.permissions);
            }

            if (user.email) {
                this.tenantContext.setMetadata('email', user.email);
            }
        }

        return next.handle();
    }

    private extractIp(request: Request): string | undefined {
        const forwarded = request.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            return forwarded.split(',')[0].trim();
        }
        return request.ip || request.socket.remoteAddress;
    }

    /**
     * Extract distributed trace context from incoming HTTP request headers
     * Supports W3C Trace Context (traceparent) and B3 propagation (X-B3-*)
     */
    private extractTraceContext(request: Request): void {
        // Try W3C Trace Context first (standard)
        const traceparent = request.headers['traceparent'] as string;
        if (traceparent) {
            // Format: 00-{trace-id}-{span-id}-{trace-flags}
            const parts = traceparent.split('-');
            if (parts.length === 4) {
                this.tenantContext.set('traceId', parts[1]);
                this.tenantContext.set('spanId', parts[2]);
            }
            return;
        }

        // Fall back to B3 propagation headers (for compatibility)
        const b3TraceId = request.headers['x-b3-traceid'] as string;
        const b3SpanId = request.headers['x-b3-spanid'] as string;
        if (b3TraceId) {
            this.tenantContext.set('traceId', b3TraceId);
        }
        if (b3SpanId) {
            this.tenantContext.set('spanId', b3SpanId);
        }
    }
}
