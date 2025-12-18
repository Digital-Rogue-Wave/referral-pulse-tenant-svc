import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { RpcMetricsService } from './rpc-metrics.service';
import { RpcMetricsInterceptor } from './rpc-metrics.interceptor';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { HelperModule } from '@mod/common/helpers/helper.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { register as promDefaultRegistry, Histogram, Counter } from 'prom-client';
import metricsConfig from '@mod/config/metrics.config';

@Global()
@Module({})
export class MonitoringModule {
    static register(): DynamicModule {
        return {
            module: MonitoringModule,
            imports: [
                ConfigModule.forFeature(metricsConfig),
                PrometheusModule.registerAsync({
                    imports: [ConfigModule.forFeature(metricsConfig)],
                    inject: [metricsConfig.KEY],
                    useFactory: (cfg: ConfigType<typeof metricsConfig>) => ({
                        path: cfg.endpoint,
                        defaultMetrics: { enabled: true }
                    })
                }),
                HelperModule
            ],
            providers: [
                // Services
                MonitoringService,
                RpcMetricsService,

                // ---- HTTP server duration
                {
                    provide: 'PrometheusHistogram_http_server_duration_seconds',
                    inject: [metricsConfig.KEY],
                    useFactory: (cfg: ConfigType<typeof metricsConfig>) =>
                        new Histogram({
                            name: 'http_server_duration_seconds',
                            help: 'HTTP server request duration (s)',
                            buckets: cfg.defaultBuckets,
                            labelNames: ['method', 'route', 'status'],
                            registers: [promDefaultRegistry]
                        })
                },

                // ---- HTTP client duration
                {
                    provide: 'PrometheusHistogram_http_client_duration_seconds',
                    inject: [metricsConfig.KEY],
                    useFactory: (cfg: ConfigType<typeof metricsConfig>) =>
                        new Histogram({
                            name: 'http_client_duration_seconds',
                            help: 'HTTP client request duration (s)',
                            buckets: cfg.defaultBuckets,
                            labelNames: ['method', 'target', 'status', 'kind'], // kind=intra|thirdparty
                            registers: [promDefaultRegistry]
                        })
                },

                // ---- SQS handler duration
                {
                    provide: 'PrometheusHistogram_sqs_handler_duration_seconds',
                    inject: [metricsConfig.KEY],
                    useFactory: (cfg: ConfigType<typeof metricsConfig>) =>
                        new Histogram({
                            name: 'sqs_handler_duration_seconds',
                            help: 'SQS message handler duration (s)',
                            buckets: cfg.defaultBuckets,
                            labelNames: ['queue', 'result'], // ok|error
                            registers: [promDefaultRegistry]
                        })
                },

                // ---- SQS processed counter
                {
                    provide: 'PrometheusCounter_sqs_messages_processed_total',
                    useFactory: () =>
                        new Counter({
                            name: 'sqs_messages_processed_total',
                            help: 'Total SQS messages processed',
                            labelNames: ['queue', 'result'],
                            registers: [promDefaultRegistry]
                        })
                },

                // ---- Billing subscription events counter
                {
                    provide: 'PrometheusCounter_billing_subscription_events_total',
                    useFactory: () =>
                        new Counter({
                            name: 'billing_subscription_events_total',
                            help: 'Total billing subscription events (Stripe webhooks, subscription.changed)',
                            labelNames: ['event', 'result'],
                            registers: [promDefaultRegistry]
                        })
                },

                // ---- RPC server duration
                {
                    provide: 'PrometheusHistogram_rpc_server_duration_seconds',
                    inject: [metricsConfig.KEY],
                    useFactory: (cfg: ConfigType<typeof metricsConfig>) =>
                        new Histogram({
                            name: 'rpc_server_duration_seconds',
                            help: 'RPC (Nest microservices) handler duration (s)',
                            buckets: cfg.defaultBuckets,
                            labelNames: ['transport', 'pattern', 'result'], // ok|error
                            registers: [promDefaultRegistry]
                        })
                },

                // ---- RPC in/out counter
                {
                    provide: 'PrometheusCounter_rpc_messages_total',
                    useFactory: () =>
                        new Counter({
                            name: 'rpc_messages_total',
                            help: 'RPC messages processed',
                            labelNames: ['direction', 'transport', 'pattern', 'result'], // direction=in|out
                            registers: [promDefaultRegistry]
                        })
                },

                // Global RPC interceptor (server-side)
                { provide: APP_INTERCEPTOR, useClass: RpcMetricsInterceptor }
            ],
            exports: [MonitoringService, RpcMetricsService]
        };
    }
}

/*

import { wrapClientProxy } from '@mod/microservices/monitoring/wrap-client-proxy.util';
import { RpcMetricsService } from '@mod/microservices/monitoring/rpc-metrics.service';

@Injectable()
export class OrdersClient {
  private readonly client: ClientProxy;

  constructor(
    private readonly clientFactory: ClientProxy, // however you obtain it
    private readonly rpcMetrics: RpcMetricsService,
  ) {
    // e.g., transport 'rmq' | 'kafka' | 'nats' ...
    this.client = wrapClientProxy(this.clientFactory, this.rpcMetrics, 'rmq');
  }

  sendCreateOrder(cmd: unknown) {
    return this.client.send('orders.create', cmd);
  }
}

 */
