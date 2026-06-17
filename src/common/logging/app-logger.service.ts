import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import pino, { Logger } from 'pino';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { ILoggerContext } from '@app/types';
import { Environment } from '@app/types';

import { JsonService } from '@common/helper/json.service';

import type { AllConfigType } from '@config/config.type';

// Log level emojis for visual identification
const LOG_EMOJIS = {
    trace: '🔍',
    debug: '🐛',
    info: '✅',
    warn: '⚠️',
    error: '❌',
    fatal: '💀'
} as const;

@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService implements LoggerService {
    private logger: Logger;
    private context?: string;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: TenantContextService,
        private readonly jsonService: JsonService
    ) {
        const nodeEnv = this.configService.getOrThrow('app.nodeEnv', {
            infer: true
        });
        const serviceName = this.configService.getOrThrow('app.name', {
            infer: true
        });
        const logLevel = this.configService.get('tracing.logLevel', { infer: true }) || 'info';
        const lokiEnabled = this.configService.get('tracing.lokiEnabled', {
            infer: true
        });
        const lokiHost = this.configService.get('tracing.lokiHost', {
            infer: true
        });

        const isDevelopment = nodeEnv === Environment.Development;
        const shouldUseLoki = !isDevelopment && lokiEnabled && lokiHost;

        // Configure transport based on environment
        const transport = isDevelopment
            ? {
                  target: 'pino-pretty',
                  options: {
                      colorize: true,
                      translateTime: 'SYS:standard',
                      ignore: 'pid,hostname',
                      messageFormat: '{emoji} {msg}'
                  }
              }
            : shouldUseLoki
              ? {
                    target: 'pino-loki',
                    options: {
                        host: lokiHost,
                        basicAuth: this.configService.get('tracing.lokiBasicAuth', {
                            infer: true
                        }),
                        labels: this.parseLokiLabels(this.configService.get('tracing.lokiLabels', { infer: true })),
                        batching: true,
                        interval:
                            this.configService.get('tracing.lokiBatchInterval', {
                                infer: true
                            }) || 5000,
                        timeout: 10000,
                        replaceTimestamp: false
                    }
                }
              : undefined;

        this.logger = pino({
            name: serviceName,
            level: logLevel,
            formatters: {
                level: (label) => ({ level: label }),
                bindings: (bindings) => ({
                    pid: bindings.pid,
                    host: bindings.hostname,
                    service: serviceName
                })
            },
            timestamp: pino.stdTimeFunctions.isoTime,
            ...(transport ? { transport } : {})
        });
    }

    private parseLokiLabels(labelsString?: string): Record<string, string> {
        if (!labelsString) {
            return { job: 'referral-campaign-service' };
        }
        try {
            return this.jsonService.parse(labelsString);
        } catch {
            return { job: 'referral-campaign-service' };
        }
    }

    setContext(context: string): void {
        this.context = context;
    }

    private getEnrichedContext(additionalContext?: Record<string, unknown>): ILoggerContext {
        const ctx: ILoggerContext = { ...additionalContext };

        if (this.context) {
            ctx.context = this.context;
        }

        try {
            if (this.tenantContext.isActive()) {
                const logContext = this.tenantContext.getLogContext();
                Object.entries(logContext).forEach(([key, value]) => {
                    if (value) {
                        ctx[key] = value;
                    }
                });
            }
        } catch {
            // ALS not active
        }

        return ctx;
    }

    log(message: string, context?: Record<string, unknown>): void {
        this.logger.info({ ...this.getEnrichedContext(context), emoji: LOG_EMOJIS.info }, `${LOG_EMOJIS.info} ${message}`);
    }

    info(message: string, context?: Record<string, unknown>): void {
        this.log(message, context);
    }

    debug(message: string, context?: Record<string, unknown>): void {
        this.logger.debug({ ...this.getEnrichedContext(context), emoji: LOG_EMOJIS.debug }, `${LOG_EMOJIS.debug} ${message}`);
    }

    warn(message: string, context?: Record<string, unknown>): void {
        this.logger.warn({ ...this.getEnrichedContext(context), emoji: LOG_EMOJIS.warn }, `${LOG_EMOJIS.warn} ${message}`);
    }

    error(message: string, trace?: string, context?: Record<string, unknown>): void {
        this.logger.error({ ...this.getEnrichedContext(context), emoji: LOG_EMOJIS.error, trace }, `${LOG_EMOJIS.error} ${message}`);
    }

    verbose(message: string, context?: Record<string, unknown>): void {
        this.logger.trace({ ...this.getEnrichedContext(context), emoji: LOG_EMOJIS.trace }, `${LOG_EMOJIS.trace} ${message}`);
    }

    fatal(message: string, context?: Record<string, unknown>): void {
        this.logger.fatal({ ...this.getEnrichedContext(context), emoji: LOG_EMOJIS.fatal }, `${LOG_EMOJIS.fatal} ${message}`);
    }

    child(bindings: Record<string, unknown>): Logger {
        return this.logger.child(bindings);
    }

    getLogger(): Logger {
        return this.logger;
    }
}
