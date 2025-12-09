import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import { IsBooleanString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';
import type { MaybeType } from '@mod/types/maybe.type';
import { AppEnvironment } from '@mod/config/app.config';

export type TransportMode = 'auto' | 'console' | 'json' | 'loki';

export type LoggerConfig = {
    // app-level
    serviceName: string;
    environment: AppEnvironment;

    // behavior
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    pretty: boolean;                  // enable pino-pretty
    transportMode: TransportMode;     // 'auto'|'console'|'json'|'loki'
    requireTransport: boolean;        // if true and mode unmet => throw during boot

    // direct Loki (optional). If undefined, we rely on stdout JSON for your Loki/S3 shippers.
    lokiUrl?: string;
    lokiBasicAuth?: string;

    // base fields to enrich (all resolved here, not in services)
    version?: string;
    k8sNamespace?: string;
    podName?: string;
    nodeName?: string;
    region?: string;
};

class LoggingEnvValidator {
    @IsEnum(AppEnvironment)
    @IsOptional()
    NODE_ENV!: MaybeType<AppEnvironment>;

    @IsString()
    @IsOptional()
    SERVICE_NAME!: MaybeType<string>;

    @IsString()
    @IsOptional()
    LOG_LEVEL!: MaybeType<LoggerConfig['level']>;

    @IsBooleanString()
    @IsOptional()
    LOG_PRETTY!: MaybeType<string>;

    @IsIn(['auto', 'console', 'json', 'loki'])
    @IsOptional()
    LOG_TRANSPORT_MODE!: MaybeType<TransportMode>;

    @IsBooleanString()
    @IsOptional()
    LOG_REQUIRE_TRANSPORT!: MaybeType<string>;

    @IsUrl({ require_tld: false })
    @IsOptional()
    LOKI_URL!: MaybeType<string>;

    @IsString()
    @IsOptional()
    LOKI_BASIC_AUTH!: MaybeType<string>;

    @IsString()
    @IsOptional()
    APP_VERSION!: MaybeType<string>;

    @IsString()
    @IsOptional()
    K8S_NAMESPACE!: MaybeType<string>;

    @IsString()
    @IsOptional()
    POD_NAME!: MaybeType<string>;

    @IsString()
    @IsOptional()
    NODE_NAME!: MaybeType<string>;

    @IsString()
    @IsOptional()
    AWS_REGION!: MaybeType<string>;

    @IsString()
    @IsOptional()
    AWS_DEFAULT_REGION!: MaybeType<string>;
}

export default registerAs<LoggerConfig>('loggerConfig', () => {
    validateConfig(process.env, LoggingEnvValidator);

    const environment = (process.env.NODE_ENV as AppEnvironment) ?? AppEnvironment.Development;
    const pretty = (process.env.LOG_PRETTY ?? (environment === AppEnvironment.Development ? 'true' : 'false')) === 'true';
    const transportMode: TransportMode = (process.env.LOG_TRANSPORT_MODE as TransportMode) ?? 'auto';
    const requireTransport = (process.env.LOG_REQUIRE_TRANSPORT ?? 'false') === 'true';

    const cfg: LoggerConfig = {
        serviceName: process.env.SERVICE_NAME ?? 'app',
        environment,
        level: (process.env.LOG_LEVEL as LoggerConfig['level']) ?? 'info',
        pretty,
        transportMode,
        requireTransport,
        lokiUrl: process.env.LOKI_URL || undefined,
        lokiBasicAuth: process.env.LOKI_BASIC_AUTH || undefined,

        version: process.env.APP_VERSION || undefined,
        k8sNamespace: process.env.K8S_NAMESPACE || undefined,
        podName: process.env.POD_NAME || process.env.HOSTNAME || undefined,
        nodeName: process.env.NODE_NAME || undefined,
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || undefined,
    };

    // enforce transport if requested
    if (cfg.requireTransport) {
        const needs =
            cfg.transportMode === 'loki' ||
            (cfg.transportMode === 'auto' && cfg.environment === AppEnvironment.Production);

        if (needs && !cfg.lokiUrl) {
            throw new Error(
                '[logger] Transport required but not configured: set LOKI_URL or choose LOG_TRANSPORT_MODE=console/json',
            );
        }
    }

    return cfg;
});
