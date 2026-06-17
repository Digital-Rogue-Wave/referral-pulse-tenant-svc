import { registerAs } from '@nestjs/config';

import { IsString, IsInt, Min, Max, IsOptional } from 'class-validator';

import validateConfig from '@app/common/validators/validate-config';

export interface ClickHouseConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
    db: string;
    protocol: string;
}

class ClickHouseConfigValidator {
    @IsString()
    @IsOptional()
    CLICKHOUSE_HOST: string | undefined;

    @IsInt()
    @Min(0)
    @Max(65535)
    CLICKHOUSE_PORT!: number;

    @IsString()
    CLICKHOUSE_USER!: string;

    @IsString()
    CLICKHOUSE_PASSWORD!: string;

    @IsString()
    CLICKHOUSE_DATABASE!: string;

    @IsString()
    CLICKHOUSE_PROTOCOL!: string;
}

export default registerAs<ClickHouseConfig>('clickhouse', () => {
    validateConfig(process.env, ClickHouseConfigValidator);

    return {
        host: process.env.CLICKHOUSE_HOST || 'localhost',
        port: process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT, 10) : 8123,
        user: process.env.CLICKHOUSE_USER || 'default',
        pass: process.env.CLICKHOUSE_PASSWORD || '',
        db: process.env.CLICKHOUSE_DATABASE || 'default',
        protocol: process.env.CLICKHOUSE_PROTOCOL || 'http'
    };
});
