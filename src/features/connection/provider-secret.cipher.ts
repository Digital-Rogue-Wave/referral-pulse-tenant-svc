import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AllConfigType } from '@config/config.type';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_HEX_LENGTH = 64;

/**
 * AES-256-GCM for `provider_connections.signing_secret`. The stored form is
 * `base64(iv ‖ tag ‖ ciphertext)` — the same layout notification-service uses for the identical value,
 * so the receivers moving to ingestion (D4) does not also change how their secret is held.
 *
 * A secret-manager reference would be stronger than an encrypted column; this is the shape that
 * matches what the platform already does, and NOTE.md §V5.12 records it as wanting a security review
 * before it holds a live credential.
 */
@Injectable()
export class ProviderSecretCipher {
    constructor(private readonly configService: ConfigService<AllConfigType>) {}

    encrypt(raw: string): string {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
        const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    }

    decrypt(stored: string): string {
        const buffer = Buffer.from(stored, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', this.key(), buffer.subarray(0, IV_LENGTH));
        decipher.setAuthTag(buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
        return Buffer.concat([decipher.update(buffer.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
    }

    /**
     * Resolved per call rather than at boot: a deployment holding no connections must still start, but
     * one asked to handle a secret without a key must fail loudly instead of storing something nothing
     * can decrypt.
     */
    private key(): Buffer {
        const keyHex = this.configService.get('connectionConfig.providerSecretEncryptionKey', { infer: true });
        if (!keyHex || keyHex.length !== KEY_HEX_LENGTH) {
            throw new Error('PROVIDER_SECRET_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes) to handle provider secrets');
        }
        return Buffer.from(keyHex, 'hex');
    }
}
