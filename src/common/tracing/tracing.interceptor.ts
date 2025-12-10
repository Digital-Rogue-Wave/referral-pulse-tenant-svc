import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { trace } from '@opentelemetry/api';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';

@Injectable()
export class TracingEnrichmentInterceptor implements NestInterceptor {
    constructor(private readonly cls: ClsService<ClsRequestContext>) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const span = trace.getActiveSpan();
        if (span) {
            const req = context.switchToHttp().getRequest<{ method: string; url: string } | undefined>();
            const tenantId = this.cls.get('tenantId') as string | undefined;
            const requestId = this.cls.get('requestId') as string | undefined;
            const userId = (this.cls.get('userId') as string | undefined) || undefined;

            span.setAttributes({
                'app.tenant_id': tenantId ?? 'unknown',
                'app.user_id': userId ?? 'anonymous',
                'http.request_id': requestId ?? 'n/a',
                'http.route': req?.url ?? '',
                'http.method': req?.method ?? ''
            });
        }

        const started = Date.now();
        return next.handle().pipe(
            tap({
                next: () => span?.setAttribute('app.handler_duration_ms', Date.now() - started),
                error: () => span?.setAttribute('app.handler_duration_ms', Date.now() - started)
            })
        );
    }
}
