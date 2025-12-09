import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import type { MaybeType } from '@mod/types/maybe.type';
import { IsEnum, IsInt, IsNumberString, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export enum OtelPropagator {
    W3C = 'w3c',
    B3 = 'b3',
}

export type TracingConfig = {
    enabled: boolean;
    serviceName: string;
    environment: string;
    otlpEndpoint: string;         // e.g. http://otel-collector:4318/v1/traces
    otlpHeaders?: Record<string, string>;
    samplerRatio: number;         // 0..1
    propagator: OtelPropagator;   // w3c|b3
};

class EnvValidator {
    @IsString() @IsOptional() OTEL_ENABLED!: MaybeType<string>;
    @IsString() @IsOptional() OTEL_SERVICE_NAME!: MaybeType<string>;
    @IsString() @IsOptional() OTEL_ENVIRONMENT!: MaybeType<string>;
    @IsUrl({ require_tld: false }) OTEL_EXPORTER_OTLP_TRACES_ENDPOINT!: string;
    @IsString() @IsOptional() OTEL_EXPORTER_OTLP_HEADERS!: MaybeType<string>; // key1=val1,key2=val2
    @IsNumberString() @IsOptional() OTEL_SAMPLER_RATIO!: MaybeType<number>;
    @IsEnum(OtelPropagator) @IsOptional() OTEL_PROPAGATOR!: MaybeType<OtelPropagator>;
}

function parseHeaders(v?: string): Record<string, string> | undefined {
    if (!v) return undefined;
    const out: Record<string, string> = {};
    for (const part of v.split(',')) {
        const [k, ...rest] = part.split('=');
        if (!k || rest.length === 0) continue;
        out[k.trim()] = rest.join('=').trim();
    }
    return Object.keys(out).length ? out : undefined;
}

export default registerAs<TracingConfig>('tracingConfig', () => {
    validateConfig(process.env, EnvValidator);
    return {
        enabled: (process.env.OTEL_ENABLED ?? 'true') === 'true',
        serviceName: process.env.OTEL_SERVICE_NAME ?? (process.env.APP_NAME ?? 'app'),
        environment: process.env.OTEL_ENVIRONMENT ?? (process.env.NODE_ENV ?? 'development'),
        otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? 'http://otel-collector:4318/v1/traces',
        otlpHeaders: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
        samplerRatio: process.env.OTEL_SAMPLER_RATIO ? Number(process.env.OTEL_SAMPLER_RATIO) : 1,
        propagator: (process.env.OTEL_PROPAGATOR as OtelPropagator) ?? OtelPropagator.W3C,
    };
});
