import { registerAs } from '@nestjs/config';
import { IsBooleanString, IsNumberString, IsOptional, IsString, ValidateIf } from 'class-validator';
import validateConfig from '@mod/common/validators/validate-config';
import { MaybeType } from '@mod/types/maybe.type';

export type DatabaseConfig = {
    url?: string;
    type?: string;
    host?: string;
    port?: number;
    password?: string;
    name?: string;
    username?: string;
    synchronize?: boolean;
    maxConnections: number;
    sslEnabled?: boolean;
    rejectUnauthorized?: boolean;
    ca?: string;
    key?: string;
    cert?: string;
};

class EnvironmentVariablesValidator {
    // If DATABASE_URL is present, validate it's a string and skip the discrete fields
    @ValidateIf((env) => !!env.DATABASE_URL)
    @IsString()
    DATABASE_URL: MaybeType<string>;

    // Otherwise require the discrete fields
    @ValidateIf((env) => !env.DATABASE_URL)
    @IsString()
    DATABASE_TYPE: MaybeType<string>;

    @ValidateIf((env) => !env.DATABASE_URL)
    @IsString()
    DATABASE_HOST: MaybeType<string>;

    @ValidateIf((env) => !env.DATABASE_URL)
    @IsNumberString()
    @IsOptional()
    DATABASE_PORT: MaybeType<string>;

    @ValidateIf((env) => !env.DATABASE_URL)
    @IsString()
    @IsOptional()
    DATABASE_PASSWORD: MaybeType<string>;

    @ValidateIf((env) => !env.DATABASE_URL)
    @IsString()
    DATABASE_NAME: MaybeType<string>;

    @ValidateIf((env) => !env.DATABASE_URL)
    @IsString()
    DATABASE_USERNAME: MaybeType<string>;

    // Booleans arrive as strings in .env -> use IsBooleanString
    @IsBooleanString()
    @IsOptional()
    DATABASE_SYNCHRONIZE: MaybeType<string>;

    // Integers arrive as strings in .env -> use IsNumberString
    @IsNumberString()
    @IsOptional()
    DATABASE_MAX_CONNECTIONS: MaybeType<string>;

    @IsBooleanString()
    @IsOptional()
    DATABASE_SSL_ENABLED: MaybeType<string>;

    @IsBooleanString()
    @IsOptional()
    DATABASE_REJECT_UNAUTHORIZED: MaybeType<string>;

    @IsString()
    @IsOptional()
    DATABASE_CA: MaybeType<string>;

    @IsString()
    @IsOptional()
    DATABASE_KEY: MaybeType<string>;

    @IsString()
    @IsOptional()
    DATABASE_CERT: MaybeType<string>;
}

export default registerAs<DatabaseConfig>('databaseConfig', () => {
    validateConfig(process.env, EnvironmentVariablesValidator);

    return {
        url: process.env.DATABASE_URL,
        type: process.env.DATABASE_TYPE,
        host: process.env.DATABASE_HOST,
        port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : 5432,
        password: process.env.DATABASE_PASSWORD,
        name: process.env.NODE_ENV === 'test' ? process.env.DATABASE_TEST_NAME : process.env.DATABASE_NAME,
        username: process.env.DATABASE_USERNAME,
        synchronize: process.env.DATABASE_SYNCHRONIZE === 'true',
        maxConnections: process.env.DATABASE_MAX_CONNECTIONS ? parseInt(process.env.DATABASE_MAX_CONNECTIONS, 10) : 100,
        sslEnabled: process.env.DATABASE_SSL_ENABLED === 'true',
        rejectUnauthorized: process.env.DATABASE_REJECT_UNAUTHORIZED === 'true',
        ca: process.env.DATABASE_CA,
        key: process.env.DATABASE_KEY,
        cert: process.env.DATABASE_CERT
    };
});
