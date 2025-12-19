import { Global, Module, DynamicModule, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import tracingConfig from '@mod/config/tracing.config';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { propagation } from '@opentelemetry/api';
import { B3Propagator } from '@opentelemetry/propagator-b3';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

// Resource helper (works across recent versions)
import { resourceFromAttributes } from '@opentelemetry/resources';

// Explicit instrumentations (array is safer than “config map”)
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { TypeormInstrumentation } from '@opentelemetry/instrumentation-typeorm';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import appConfig from '@mod/config/app.config';

@Global()
@Module({})
export class TracingModule implements OnModuleDestroy {
    constructor(private readonly sdk: NodeSDK) {}
    async onModuleDestroy(): Promise<void> {
        if (this.sdk && typeof this.sdk.shutdown === 'function') {
            await this.sdk.shutdown().catch(() => void 0);
        }
    }

    static register(): DynamicModule {
        return {
            module: TracingModule,
            imports: [ConfigModule.forFeature(tracingConfig), ConfigModule.forFeature(appConfig)],
            providers: [
                {
                    provide: NodeSDK,
                    inject: [tracingConfig.KEY, appConfig.KEY],
                    useFactory: async (cfg: ConfigType<typeof tracingConfig>, app: ConfigType<typeof appConfig>) => {
                        if (!cfg.enabled) {
                            return {
                                start: () => Promise.resolve(),
                                shutdown: () => Promise.resolve()
                            } as unknown as NodeSDK;
                        }

                        // OTLP exporter
                        const exporter = new OTLPTraceExporter({
                            url: cfg.otlpEndpoint,
                            headers: cfg.otlpHeaders
                        });

                        // Minimal, correct resource: only service-level/static attrs
                        const resource = resourceFromAttributes({
                            'service.name': cfg.serviceName,
                            'service.version': process.env.APP_VERSION ?? '0.0.0',
                            'deployment.environment': cfg.environment,
                            'app.name': app.name
                        });

                        // Parent-based sampler w/ ratio
                        const sampler = new ParentBasedSampler({
                            root: new TraceIdRatioBasedSampler(Math.max(0, Math.min(1, cfg.samplerRatio)))
                        });

                        // Instrumentations (HTTP hook sets url.full on spans)
                        const httpInstr = new HttpInstrumentation({
                            requestHook: (span, info) => {
                                try {
                                    // Incoming server request
                                    const req: any = (info as any)?.request;
                                    if (req && typeof req.url === 'string') {
                                        const path = req.url;
                                        const host = req.headers?.host as string | undefined;
                                        const proto =
                                            (req.headers?.['x-forwarded-proto'] as string | undefined) ?? (req.socket?.encrypted ? 'https' : 'http');
                                        const full = host ? `${proto}://${host}${path}` : path;
                                        span.setAttribute('url.full', full);
                                        return;
                                    }

                                    // Outgoing client request (covers Axios as it uses http/https)
                                    const opts: any = (info as any)?.options ?? (info as any)?.requestOptions ?? {};
                                    const protocol = (opts.protocol ?? (opts.port === 443 ? 'https:' : 'http:')).toString().replace(':', '');
                                    const host = opts.hostname ?? opts.host ?? '';
                                    const port = opts.port ? `:${opts.port}` : '';
                                    const path = opts.path ?? '';
                                    const full = host ? `${protocol}://${host}${port}${path}` : path;
                                    if (full) span.setAttribute('url.full', full);
                                } catch {
                                    // best-effort only; ignore hook errors
                                }
                            }
                        });

                        const instrumentations = [
                            httpInstr,
                            new ExpressInstrumentation(),
                            new NestInstrumentation(),
                            new IORedisInstrumentation(),
                            new PgInstrumentation(),
                            new TypeormInstrumentation(),
                            new AwsInstrumentation()
                        ];

                        const sdk = new NodeSDK({
                            resource,
                            traceExporter: exporter,
                            sampler,
                            instrumentations
                        });

                        // Propagation
                        const propagator = cfg.propagator === 'b3' ? new B3Propagator() : new W3CTraceContextPropagator();
                        propagation.setGlobalPropagator(propagator);

                        await sdk.start();
                        return sdk;
                    }
                }
            ],
            exports: []
        };
    }
}
