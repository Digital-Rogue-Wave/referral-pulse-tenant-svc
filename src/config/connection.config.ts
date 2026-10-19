import { registerAs } from '@nestjs/config';
import { IsHexadecimal, IsOptional, IsString, Length } from 'class-validator';

import validateConfig from '@common/validators/validate-config';
import { MaybeType } from '@app/types';

/**
 * Provider connection secrets (Architecture v5 §2.1: "provider connection config and secrets … webhook
 * signing secrets"). The key encrypts `provider_connections.signing_secret` at rest.
 */
export type ConnectionConfig = {
    /** 32 bytes as 64 hex characters, for AES-256-GCM. */
    providerSecretEncryptionKey?: MaybeType<string>;
};

class ConnectionEnvValidator {
    /**
     * Optional at load, required at use. A deployment that holds no provider connections yet must still
     * boot; one that is asked to encrypt or read a secret without the key fails loudly instead of
     * storing something it cannot decrypt (`ProviderSecretCipher`).
     */
    @IsString()
    @IsOptional()
    @IsHexadecimal()
    @Length(64, 64, { message: 'PROVIDER_SECRET_ENCRYPTION_KEY must be 64 hex characters (32 bytes) for AES-256-GCM' })
    PROVIDER_SECRET_ENCRYPTION_KEY?: MaybeType<string>;
}

export default registerAs<ConnectionConfig>('connectionConfig', () => {
    validateConfig(process.env, ConnectionEnvValidator);

    return {
        providerSecretEncryptionKey: process.env.PROVIDER_SECRET_ENCRYPTION_KEY
    };
});
