import { Injectable, LoggerService, Inject } from '@nestjs/common';
import pino, { Logger as PinoLogger } from 'pino';
import { ClsService } from 'nestjs-cls';
import { ConfigType } from '@nestjs/config';
import loggerConfig, { LoggerConfig } from '@mod/config/logger.config';
import { ErrorFields, JsonRecord, LogContext } from '@mod/types/app.type';
import { HelperService } from '@mod/common/helpers/helper.service';

function baseBindings(config: LoggerConfig) {
    return {
        service: config.serviceName,
        env: config.environment,
        version: config.version,
        k8sNamespace: config.k8sNamespace,
        podName: config.podName,
        nodeName: config.nodeName,
        region: config.region,
    };
}

@Injectable()
export class AppLoggingService implements LoggerService {
    private logger: PinoLogger;
    private readonly baseBindings: ReturnType<typeof baseBindings>;

    constructor(
        private readonly helper: HelperService,
        @Inject(loggerConfig.KEY) private readonly cfg: ConfigType<typeof loggerConfig>,
        private readonly cls: ClsService<LogContext>,
    ) {
        this.baseBindings = baseBindings(cfg);

        const transport = helper.buildTransport(cfg);
        this.logger = transport
            ? pino(
                { level: cfg.level, base: this.baseBindings, timestamp: pino.stdTimeFunctions.isoTime },
                pino.transport(transport),
            )
            : pino({ level: cfg.level, base: this.baseBindings, timestamp: pino.stdTimeFunctions.isoTime });
    }

    // ------- helpers

    private ctx(): LogContext {
        return {
            tenantId: this.cls.get('tenantId'),
            userId: this.cls.get('userId'),
            requestId: this.cls.get('requestId'),
            traceId: this.cls.get('traceId'),
            spanId: this.cls.get('spanId'),

            // ADD ALB trace context
            albTraceRoot: this.cls.get('albTraceRoot'),
            albParentId: this.cls.get('albParentId'),
            albSampled: this.cls.get('albSampled'),
        };
    }

    private withError(err?: unknown): ErrorFields | undefined {
        if (!err || !(err instanceof Error)) return undefined;
        return { errName: err.name, errMessage: err.message, stack: err.stack };
    }

    private payload(meta?: JsonRecord, err?: unknown, context?: string): JsonRecord {
        const safeMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : undefined;
        return {
            ...this.ctx(),
            ...(context ? { context } : {}),
            ...(safeMeta ?? {}),
            ...(this.withError(err) ?? {}),
        };
    }

    private asMessage(input: unknown): string | undefined {
        if (typeof input === 'string') return input;
        if (input instanceof Error) return input.message;
        if (input && typeof input === 'object' && 'message' in input && typeof (input as any).message === 'string') {
            return (input as any).message;
        }
        return undefined;
    }

    private shouldDownlevelToDebug(context?: string): boolean {
        return context === 'InstanceLoader' || context === 'RoutesResolver' || context === 'RouterExplorer';
    }

    // ------- Nest LoggerService API (correct signatures)

    log(message: unknown, context?: string): void {
        const msg = this.asMessage(message);
        const meta = this.payload(undefined, undefined, context);
        if (this.shouldDownlevelToDebug(context)) this.logger.debug(meta, msg);
        else this.logger.info(meta, msg);
    }

    error(message: unknown, trace?: string, context?: string): void {
        if (message instanceof Error) {
            const meta = this.payload(undefined, message, context);
            this.logger.error(meta, message.message);
            return;
        }
        const meta = this.payload(trace ? { trace } as JsonRecord : undefined, undefined, context);
        this.logger.error(meta, this.asMessage(message) ?? String(message));
    }

    warn(message: unknown, context?: string): void {
        this.logger.warn(this.payload(undefined, undefined, context), this.asMessage(message) ?? String(message));
    }

    debug(message: unknown, context?: string): void {
        this.logger.debug(this.payload(undefined, undefined, context), this.asMessage(message) ?? String(message));
    }

    verbose(message: unknown, context?: string): void {
        this.logger.trace(this.payload(undefined, undefined, context), this.asMessage(message) ?? String(message));
    }

    // ------- Convenience (structured) — used directly by your code

    info(message: string, meta?: JsonRecord): void {
        this.logger.info(this.payload(meta), message);
    }

    fatal(message: string, meta?: JsonRecord, err?: unknown): void {
        this.logger.fatal(this.payload(meta, err), message);
    }

    /** child logger with sticky fields (e.g., domain/component) */
    child(bindings: JsonRecord): AppLoggingService {
        const child = Object.create(this) as AppLoggingService;
        (child as unknown as { logger: PinoLogger }).logger = this.logger.child(bindings);
        return child;
    }
}
