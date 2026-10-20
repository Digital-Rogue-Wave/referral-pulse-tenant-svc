import { registerAs } from '@nestjs/config';
import { IsHexadecimal, IsOptional, IsString, Length } from 'class-validator';

import validateConfig from '@common/validators/validate-config';
import { MaybeType } from '@app/types';

/**
 * The secrets Architecture v5 §2.1 puts in this service for other services to use: "provider
 * connection config and secrets (billing, payout, CRM; webhook signing secrets; tracking-token key)".
 * Grouped in one config block because the spec groups them.
 */
export type ConnectionConfig = {
    /** 32 bytes as 64 hex characters, for AES-256-GCM over `provider_connections.signing_secret`. */
    providerSecretEncryptionKey?: MaybeType<string>;
    /**
     * The platform's email-tracking token key: notification-service signs `/t/o` and `/t/c` tokens
     * with it and ingestion-service verifies them (Architecture §2.4, Product Spec §12). One key, not
     * one per tenant — §2.1 names it in the singular, and the token carries the tenant id under the
     * signature, so a per-tenant key would add rotation surface without adding isolation.
     */
    trackingTokenKey?: MaybeType<string>;
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

    /** 32 bytes of entropy, hex. Long enough that an HMAC-SHA256 tracking token cannot be forged. */
    @IsString()
    @IsOptional()
    @IsHexadecimal()
    @Length(64, 64, { message: 'TRACKING_TOKEN_KEY must be 64 hex characters (32 bytes)' })
    TRACKING_TOKEN_KEY?: MaybeType<string>;
}

export default registerAs<ConnectionConfig>('connectionConfig', () => {
    validateConfig(process.env, ConnectionEnvValidator);

    return {
        providerSecretEncryptionKey: process.env.PROVIDER_SECRET_ENCRYPTION_KEY,
        trackingTokenKey: process.env.TRACKING_TOKEN_KEY
    };
});
