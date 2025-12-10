import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import { IsUrl, IsString, IsOptional } from 'class-validator';
import type { MaybeType } from '@mod/types/maybe.type';

export type OryConfig = {
    hydra: {
        publicUrl: string;
        jwksUrl: string;
        issuer: string;
    };
    keto: {
        readUrl: string;
        writeUrl: string;
    };
    kratos?: {
        adminUrl: string;
        publicUrl: string;
    };
    audience: string;
};

class OryEnvValidator {
    @IsUrl({ require_tld: false })
    ORY_HYDRA_PUBLIC_URL!: string;

    @IsUrl({ require_tld: false })
    @IsOptional()
    ORY_HYDRA_JWKS_URL?: MaybeType<string>;

    @IsString()
    ORY_HYDRA_ISSUER!: string;

    @IsUrl({ require_tld: false })
    ORY_KETO_READ_URL!: string;

    @IsUrl({ require_tld: false })
    ORY_KETO_WRITE_URL!: string;

    @IsString()
    JWT_AUDIENCE!: string;

    @IsUrl({ require_tld: false })
    @IsOptional()
    ORY_KRATOS_ADMIN_URL?: MaybeType<string>;

    @IsUrl({ require_tld: false })
    @IsOptional()
    ORY_KRATOS_PUBLIC_URL?: MaybeType<string>;
}

export default registerAs<OryConfig>('oryConfig', () => {
    validateConfig(process.env, OryEnvValidator);

    const hydraPublicUrl = process.env.ORY_HYDRA_PUBLIC_URL as string;
    const jwksUrl = process.env.ORY_HYDRA_JWKS_URL || `${hydraPublicUrl}/.well-known/jwks.json`;

    return {
        hydra: {
            publicUrl: hydraPublicUrl,
            jwksUrl,
            issuer: process.env.ORY_HYDRA_ISSUER as string
        },
        keto: {
            readUrl: process.env.ORY_KETO_READ_URL as string,
            writeUrl: process.env.ORY_KETO_WRITE_URL as string
        },
        audience: process.env.JWT_AUDIENCE as string
    };
});
