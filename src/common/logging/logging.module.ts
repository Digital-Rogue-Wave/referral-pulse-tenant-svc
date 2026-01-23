import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { AllConfigType } from '@app/config/config.type';
import { Environment } from '@app/types';
import { AppLoggerService } from '@common/logging/app-logger.service';

@Global()
@Module({
    imports: [
        PinoLoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService<AllConfigType>) => {
                const nodeEnv = configService.getOrThrow('app.nodeEnv', { infer: true });
                const serviceName = configService.getOrThrow('app.name', { infer: true });
                const logLevel = configService.get('tracing.logLevel', { infer: true }) || 'info';
                const lokiEnabled = configService.get('tracing.lokiEnabled', { infer: true });
                const lokiHost = configService.get('tracing.lokiHost', { infer: true });

                const isDevelopment = nodeEnv === Environment.Development;
                const shouldUseLoki = !isDevelopment && lokiEnabled && lokiHost;

                // Parse Loki labels
                const parseLokiLabels = (labelsString?: string): Record<string, string> => {
                    if (!labelsString) {
                        return { job: serviceName, environment: nodeEnv };
                    }
                    try {
                        return JSON.parse(labelsString);
                    } catch {
                        return { job: serviceName, environment: nodeEnv };
                    }
                };

                // Configure transport based on environment
                const transport = isDevelopment
                    ? {
                          target: 'pino-pretty',
                          options: {
                              colorize: true,
                              translateTime: 'SYS:standard',
                              ignore: 'pid,hostname',
                              singleLine: false,
                          },
                      }
                    : shouldUseLoki
                      ? {
                            target: 'pino-loki',
                            options: {
                                host: lokiHost,
                                basicAuth: configService.get('tracing.lokiBasicAuth', { infer: true }),
                                labels: parseLokiLabels(configService.get('tracing.lokiLabels', { infer: true })),
                                batching: true,
                                interval: configService.get('tracing.lokiBatchInterval', { infer: true }) || 5000,
                                timeout: 10000,
                                replaceTimestamp: false,
                            },
                        }
                      : undefined;

                return {
                    pinoHttp: {
                        level: logLevel,
                        autoLogging: {
                            ignore: (req) => ['/health', '/metrics'].some((p) => req.url?.startsWith(p)),
                        },
                        customSuccessMessage: (req, res) => {
                            return `✅ ${req.method} ${req.url} ${res.statusCode}`;
                        },
                        customErrorMessage: (req, res, err) => {
                            return `❌ ${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
                        },
                        ...(transport ? { transport } : {}),
                    },
                };
            },
        }),
    ],
    providers: [AppLoggerService],
    exports: [AppLoggerService, PinoLoggerModule],
})
export class LoggingModule {}
