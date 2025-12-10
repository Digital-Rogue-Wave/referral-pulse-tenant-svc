import type { ClientProxy } from '@nestjs/microservices';
import { finalize, tap } from 'rxjs';
import { RpcMetricsService } from './rpc-metrics.service';

function nowSeconds(): number {
    return Number(process.hrtime.bigint()) / 1_000_000_000;
}

/**
 * Wraps a ClientProxy to record Prometheus metrics for outbound send/emit.
 * Usage:
 *   const client = wrapClientProxy(factory.create(...), metrics, 'rmq');
 */
export function wrapClientProxy<T extends ClientProxy>(client: T, metrics: RpcMetricsService, transport: string): T {
    const proxy = new Proxy(client, {
        get(target, prop, receiver) {
            if (prop === 'send') {
                return function (pattern: unknown, data: unknown) {
                    const patternLabel = typeof pattern === 'string' ? pattern : JSON.stringify(pattern);
                    const startedAt = nowSeconds();
                    const result$ = Reflect.apply(target.send, target, [pattern, data]);
                    return result$.pipe(
                        tap(() => metrics.incMessages('out', transport, patternLabel, 'ok')),
                        finalize(() => {
                            const duration = nowSeconds() - startedAt;
                            metrics.observeServerDuration(transport, patternLabel, 'ok', duration);
                        })
                    );
                };
            }
            if (prop === 'emit') {
                return function (pattern: unknown, data: unknown) {
                    const patternLabel = typeof pattern === 'string' ? pattern : JSON.stringify(pattern);
                    const startedAt = nowSeconds();
                    const result$ = Reflect.apply(target.emit, target, [pattern, data]);
                    return result$.pipe(
                        tap(() => metrics.incMessages('out', transport, patternLabel, 'ok')),
                        finalize(() => {
                            const duration = nowSeconds() - startedAt;
                            metrics.observeServerDuration(transport, patternLabel, 'ok', duration);
                        })
                    );
                };
            }
            return Reflect.get(target, prop, receiver);
        }
    });

    return proxy as T;
}
