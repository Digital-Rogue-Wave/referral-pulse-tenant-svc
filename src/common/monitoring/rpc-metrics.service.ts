import { Inject, Injectable } from '@nestjs/common';
import type { Histogram, Counter } from 'prom-client';

@Injectable()
export class RpcMetricsService {
    constructor(
        @Inject('PrometheusHistogram_rpc_server_duration_seconds')
        private readonly rpcServerDuration: Histogram<string>,
        @Inject('PrometheusCounter_rpc_messages_total')
        private readonly rpcMessagesTotal: Counter<string>,
    ) {}

    observeServerDuration(
        transport: string,
        pattern: string,
        result: 'ok' | 'error',
        seconds: number,
    ): void {
        this.rpcServerDuration.labels(transport, pattern, result).observe(seconds);
    }

    incMessages(
        direction: 'in' | 'out',
        transport: string,
        pattern: string,
        result: 'ok' | 'error',
    ): void {
        this.rpcMessagesTotal.labels(direction, transport, pattern, result).inc(1);
    }
}
