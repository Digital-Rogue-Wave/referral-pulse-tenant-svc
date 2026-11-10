import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';

import { ProviderSecretCipher } from '../connection/provider-secret.cipher';

/** HMAC-SHA256's block size; hex-encoded to 64 characters. */
const SECRET_BYTES = 32;
/** A value stored before US1.5.4 F5: the plain secret, not yet sealed. */
const LEGACY_PLAIN = /^[0-9a-f]{64}$/;

/**
 * The widget-token secret at rest (US1.5.4 F5): sealed with the same AES-256-GCM cipher as provider
 * secrets, so every tenant secret gets one treatment and one key.
 */
@Injectable()
export class WidgetSecretVault {
    constructor(private readonly cipher: ProviderSecretCipher) {}

    /** A fresh secret, and the form the `tenants` row stores. */
    generate(): { raw: string; sealed: string } {
        const raw = randomBytes(SECRET_BYTES).toString('hex');
        return { raw, sealed: this.cipher.encrypt(raw) };
    }

    seal(raw: string): string {
        return this.cipher.encrypt(raw);
    }

    /** The plain secret; `legacy` tells the caller the stored value still needs sealing. */
    open(stored: string): { raw: string; legacy: boolean } {
        if (LEGACY_PLAIN.test(stored)) {
            return { raw: stored, legacy: true };
        }
        return { raw: this.cipher.decrypt(stored), legacy: false };
    }
}
