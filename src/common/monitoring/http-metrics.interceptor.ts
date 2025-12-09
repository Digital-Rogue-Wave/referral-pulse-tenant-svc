import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MonitoringService } from './monitoring.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
    constructor(private readonly metrics: MonitoringService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const req = context.switchToHttp().getRequest<{ method: string; route?: { path?: string }; originalUrl?: string }>();
        const method = req?.method ?? 'GET';
        const route = req?.route?.path ?? req?.originalUrl ?? 'unknown';
        const start = process.hrtime.bigint();

        return next.handle().pipe(
            tap({
                next: () => {
                    const res = context.switchToHttp().getResponse<{ statusCode?: number }>();
                    const status = res?.statusCode ?? 200;
                    const end = process.hrtime.bigint();
                    const seconds = Number(end - start) / 1_000_000_000;
                    this.metrics.observeHttpServer(method, route, status, seconds);
                },
                error: () => {
                    const res = context.switchToHttp().getResponse<{ statusCode?: number }>();
                    const status = res?.statusCode ?? 500;
                    const end = process.hrtime.bigint();
                    const seconds = Number(end - start) / 1_000_000_000;
                    this.metrics.observeHttpServer(method, route, status, seconds);
                },
            }),
        );
    }
}
