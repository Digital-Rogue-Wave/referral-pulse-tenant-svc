import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { RpcMetricsService } from './rpc-metrics.service';
import { Reflector } from '@nestjs/core';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { HelperService } from '@mod/common/helpers/helper.service';

@Injectable()
export class RpcMetricsInterceptor implements NestInterceptor {
    constructor(
        private readonly metrics: RpcMetricsService,
        private readonly helper: HelperService,
        private readonly reflector: Reflector,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType<'rpc' | 'http' | 'ws'>() !== 'rpc') {
            return next.handle(); // monitor only microservice RPC flows
        }

        const transport = this.helper.resolveRpcTransport(context);

        // Prefer decorator metadata; fallback to transport context.getPattern()
        let rawPattern: unknown = this.reflector.get(PATTERN_METADATA, context.getHandler());
        if (rawPattern === undefined) {
            const transportContext = context.switchToRpc().getContext<unknown>();
            if (this.helper.hasGetPattern(transportContext)) {
                rawPattern = transportContext.getPattern();
            }
        }
        const pattern = typeof rawPattern === 'string' ? rawPattern : rawPattern != null ? JSON.stringify(rawPattern) : 'unknown';

        const startedAt = process.hrtime.bigint();
        let result: 'ok' | 'error' = 'ok';

        return next.handle().pipe(
            tap(() => this.metrics.incMessages('in', transport, pattern, 'ok')),
            catchError((caughtError: unknown) => {
                result = 'error';
                this.metrics.incMessages('in', transport, pattern, 'error');
                return throwError(() => caughtError);
            }),
            finalize(() => {
                const seconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
                this.metrics.observeServerDuration(transport, pattern, result, seconds);
            }),
        );
    }
}
