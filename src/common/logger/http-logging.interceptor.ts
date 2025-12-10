import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';
import { AppLoggingService } from './app-logging.service';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
    constructor(
        private readonly logger: AppLoggingService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType<'http' | 'rpc' | 'ws'>() !== 'http') {
            return next.handle();
        }

        const req = context.switchToHttp().getRequest<{
            method?: string;
            originalUrl?: string;
            ip?: string;
            headers?: Record<string, string>;
        }>();
        const res = context.switchToHttp().getResponse<{ statusCode?: number }>();

        const method = (req.method ?? 'GET').toUpperCase();
        const path = (req.originalUrl ?? '').split('?')[0] ?? '';
        const requestId = this.cls.get('requestId');
        const tenantId = this.cls.get('tenantId');
        const userId = (this.cls.get('userId') as string | undefined) ?? undefined;

        const started = process.hrtime.bigint();

        return next.handle().pipe(
            catchError((caught: unknown) => {
                const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
                const status = res.statusCode ?? 500;

                this.logger.fatal(
                    'http_request_error',
                    {
                        method,
                        path,
                        status,
                        durationMs,
                        requestId,
                        tenantId,
                        userId
                    },
                    caught
                );

                return throwError(() => caught);
            }),
            finalize(() => {
                if ((res.statusCode ?? 0) < 400) {
                    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
                    this.logger.info('http_request', {
                        method,
                        path,
                        status: res.statusCode ?? 200,
                        durationMs,
                        requestId,
                        tenantId,
                        userId
                    });
                }
            })
        );
    }
}
