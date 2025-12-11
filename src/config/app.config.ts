import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import { MaybeType } from '@mod/types/maybe.type';
import { IsEnum, IsNumberString, IsOptional, IsString, IsUrl } from 'class-validator';

export enum AppEnvironment {
    Development = 'development',
    Production = 'production',
    Test = 'test',
    Staging = 'staging'
}

export type AppConfig = {
    nodeEnv: MaybeType<string>;
    name: MaybeType<string>;
    workingDirectory: MaybeType<string>;
    frontendDomain?: MaybeType<string>;
    backendDomain: MaybeType<string>;
    port: number;
    apiPrefix: MaybeType<string>;
    fallbackLanguage: MaybeType<string>;
    headerLanguage: MaybeType<string>;
    invitationExpiryDays: number;
};

class EnvironmentVariablesValidator {
    @IsEnum(AppEnvironment)
    @IsOptional()
    NODE_ENV: MaybeType<AppEnvironment>;

    @IsNumberString()
    @IsOptional()
    APP_PORT: MaybeType<number>;

    @IsUrl({ require_tld: false })
    @IsOptional()
    FRONTEND_DOMAIN: MaybeType<string>;

    @IsUrl({ require_tld: false })
    @IsOptional()
    BACKEND_DOMAIN: MaybeType<string>;

    @IsString()
    @IsOptional()
    API_PREFIX: MaybeType<string>;

    @IsString()
    @IsOptional()
    APP_FALLBACK_LANGUAGE: MaybeType<string>;

    @IsString()
    @IsOptional()
    APP_HEADER_LANGUAGE: MaybeType<string>;

    @IsNumberString()
    @IsOptional()
    INVITATION_EXPIRY_DAYS: MaybeType<number>;
}

export default registerAs<AppConfig>('appConfig', () => {
    validateConfig(process.env, EnvironmentVariablesValidator);

    return {
        nodeEnv: process.env.NODE_ENV || AppEnvironment.Development,
        name: process.env.APP_NAME || 'app',
        workingDirectory: process.env.PWD || process.cwd(),
        frontendDomain: process.env.FRONTEND_DOMAIN,
        backendDomain: process.env.BACKEND_DOMAIN ?? 'http://localhost',
        port: process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
        apiPrefix: process.env.API_PREFIX || 'api',
        fallbackLanguage: process.env.APP_FALLBACK_LANGUAGE || 'en',
        headerLanguage: process.env.APP_HEADER_LANGUAGE || 'x-custom-lang',
        invitationExpiryDays: process.env.INVITATION_EXPIRY_DAYS ? parseInt(process.env.INVITATION_EXPIRY_DAYS, 10) : 7
    };
});
