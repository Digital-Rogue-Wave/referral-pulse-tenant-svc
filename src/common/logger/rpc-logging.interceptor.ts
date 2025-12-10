import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';
import { AppLoggingService } from './app-logging.service';
import { HelperService } from '@mod/common/helpers/helper.service';

@Injectable()
export class RpcLoggingInterceptor implements NestInterceptor {
    constructor(
        private readonly logger: AppLoggingService,
        private readonly helper: HelperService,
        private readonly reflector: Reflector,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType<'rpc' | 'http' | 'ws'>() !== 'rpc') return next.handle();

        const transport = this.helper.resolveRpcTransport(context);

        let rawPattern: unknown = this.reflector.get(PATTERN_METADATA, context.getHandler());
        if (rawPattern === undefined) {
            const transportContext = context.switchToRpc().getContext<unknown>();
            if (this.helper.hasGetPattern(transportContext)) {
                rawPattern = transportContext.getPattern();
            }
        }
        const pattern = typeof rawPattern === 'string' ? rawPattern : rawPattern != null ? JSON.stringify(rawPattern) : 'unknown';

        const requestId = this.cls.get('requestId');
        const tenantId = this.cls.get('tenantId');
        const userId = (this.cls.get('userId') as string | undefined) ?? undefined;

        const startedAt = process.hrtime.bigint();

        return next.handle().pipe(
            catchError((caughtError: unknown) => {
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

                this.logger.fatal('rpc_message_error', { transport, pattern, durationMs, requestId, tenantId, userId }, caughtError);

                return throwError(() => caughtError);
            }),
            finalize(() => {
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
                this.logger.info('rpc_message', {
                    transport,
                    pattern,
                    durationMs,
                    requestId,
                    tenantId,
                    userId
                });
            })
        );
    }
}
