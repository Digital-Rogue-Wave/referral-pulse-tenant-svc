import { type ExecutionContext, Injectable } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import betterStacktrace from 'axios-better-stacktrace';
import { RetryConfig } from '@mod/config/http-client.config';
import { LoggerConfig } from '@mod/config/logger.config';
import { TransportMultiOptions } from 'pino';
import { RpcTransport } from '@mod/types/app.type';

@Injectable()
export class HelperService {
    randomInt(min: number, max: number): number {
        const low = Math.ceil(min);
        const high = Math.floor(max);
        return Math.floor(Math.random() * (high - low + 1)) + low;
    }

    // AFTER
    deriveBreakerKey(namespace: string, baseURL?: string): string {
        if (baseURL) {
            try {
                const { host } = new URL(baseURL);
                return `${namespace}:${host}`;
            } catch {
                // fall back to namespace
            }
        }
        return namespace;
    }

    configureAxios(instance: AxiosInstance, retryCfg: RetryConfig): void {
        // Better stack traces first
        betterStacktrace(instance);

        axiosRetry(instance, {
            retries: retryCfg.retries,
            shouldResetTimeout: true,
            retryDelay: (count, error) => axiosRetry.exponentialDelay(count, error, retryCfg.baseDelayMs),
            retryCondition: (error) =>
                axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                (!!error.response && retryCfg.retryOnStatuses.includes(error.response.status)),
        });
    }

    buildTransport(cfg: LoggerConfig): TransportMultiOptions | undefined {
        const pretty = cfg.pretty || cfg.transportMode === 'console';
        if (pretty) {
            return {
                targets: [
                    {
                        target: 'pino-pretty',
                        options: {
                            colorize: true,
                            singleLine: true,
                            translateTime: 'UTC:yyyy-mm-dd"T"HH:MM:ss.l"Z"',
                        },
                        level: cfg.level,
                    },
                ],
            };
        }

        if (cfg.transportMode === 'json') {
            return undefined; // JSON to stdout
        }

        const shouldUseLoki =
            cfg.transportMode === 'loki' || (cfg.transportMode === 'auto' && !!cfg.lokiUrl);

        if (shouldUseLoki && cfg.lokiUrl) {
            return {
                targets: [
                    {
                        target: '@grafana/pino-loki',
                        level: cfg.level,
                        options: {
                            batching: true,
                            interval: 1000,
                            labels: { service: cfg.serviceName, env: cfg.environment },
                            host: cfg.lokiUrl,
                            basicAuth: cfg.lokiBasicAuth,
                        },
                    },
                ],
            };
        }

        return undefined;
    }

    resolveRpcTransport(context: ExecutionContext): RpcTransport {
        const rpcContext = context.switchToRpc().getContext<unknown>();
        const ctorName =
            typeof (rpcContext as Partial<{ constructor: { name?: string } }>)?.constructor?.name === 'string'
                ? ((rpcContext as { constructor: { name: string } }).constructor.name)
                : undefined;

        switch (ctorName) {
            case 'RmqContext': return 'rmq';
            case 'KafkaContext': return 'kafka';
            case 'NatsContext': return 'nats';
            case 'RedisContext': return 'redis';
            case 'MqttContext': return 'mqtt';
            case 'GrpcContext': return 'grpc';
            case 'TcpContext': return 'tcp';
            default: return 'unknown';
        }
    }
    hasGetPattern(value: unknown): value is { getPattern: () => unknown } {
        return typeof value === 'object' && value !== null && 'getPattern' in value && typeof (value as { getPattern: unknown }).getPattern === 'function';
    }
}
