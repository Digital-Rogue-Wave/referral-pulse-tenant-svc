import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma-gen/generated/client';

import { ProviderSecretCipher } from '../connection/provider-secret.cipher';

/** HMAC-SHA256's block size; hex-encoded to 64 characters. */
const SECRET_BYTES = 32;
/** The spec gives no `kid` format: 8 random bytes as 16 hex characters, unique per tenant in practice. */
const KID_BYTES = 8;
/** A value stored before US1.5.4 F5: the plain secret, not yet sealed. */
const LEGACY_PLAIN = /^[0-9a-f]{64}$/;

/** One entry of `tenants.widget_signing_secrets` (DB Model v5.2 §3): `{kid, secret_encrypted, created_at}`. */
export interface StoredSigningSecret {
    kid: string;
    secret_encrypted: string;
    created_at: Date;
}

/**
 * The widget signing secrets at rest (US1.5.4 F5): sealed with the same AES-256-GCM cipher as provider
 * secrets, so every tenant secret gets one treatment and one key.
 */
@Injectable()
export class WidgetSecretVault {
    constructor(private readonly cipher: ProviderSecretCipher) {}

    /** A fresh secret under a fresh `kid`, and the entry the `tenants` row stores. */
    mint(createdAt: Date): { raw: string; stored: StoredSigningSecret } {
        const raw = randomBytes(SECRET_BYTES).toString('hex');
        return { raw, stored: { kid: randomBytes(KID_BYTES).toString('hex'), secret_encrypted: this.cipher.encrypt(raw), created_at: createdAt } };
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

    /**
     * The column value for these entries, `created_at` as an ISO string: Prisma would otherwise write a `Date`
     * inside Json as its own `{"$type": "DateTime"}` wrapper, which no other reader understands.
     */
    toColumn(entries: StoredSigningSecret[]): Prisma.InputJsonValue {
        return entries.map((entry) => ({ kid: entry.kid, secret_encrypted: entry.secret_encrypted, created_at: entry.created_at.toISOString() }));
    }

    /** The jsonb column as typed entries, newest first; anything malformed is not a secret. */
    parse(column: unknown): StoredSigningSecret[] {
        if (!Array.isArray(column)) {
            return [];
        }
        return column
            .filter(
                (entry): entry is { kid: string; secret_encrypted: string; created_at: string } =>
                    typeof entry?.kid === 'string' && typeof entry?.secret_encrypted === 'string' && typeof entry?.created_at === 'string'
            )
            .map((entry) => ({ kid: entry.kid, secret_encrypted: entry.secret_encrypted, created_at: new Date(entry.created_at) }));
    }
}
