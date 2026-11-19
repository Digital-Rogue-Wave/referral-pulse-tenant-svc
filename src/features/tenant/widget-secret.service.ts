import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { WidgetSigningSecretsResponse } from '@domains/tenant';
import { TenantEvents, TenantWidgetSecretRevealedEvent, TenantWidgetSecretRotatedEvent } from '@domains/tenant/events/tenant.events';

import { StoredSigningSecret, WidgetSecretVault } from './widget-secret.vault';

/** v5.2 API §3.17: after a rotation the previous secret stays valid for 7 days. */
const PREVIOUS_SECRET_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * The widget signing secrets (v5.2 US1.5.5, DB Model §3 `tenants.widget_signing_secrets`): at most two active
 * entries, newest first, each with its `kid`. The previous one is valid until the newest's `created_at` + 7 days.
 * Readers: the Owner (read and rotate, both audited) and Event Ingestion (service read).
 */
@Injectable()
export class WidgetSecretService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly vault: WidgetSecretVault,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(WidgetSecretService.name);
    }

    /** The Owner's read: both active secrets in full. Every read writes an audit row naming the reader. */
    async reveal(tenantId: string, userId: string): Promise<WidgetSigningSecretsResponse> {
        return this.prisma.$transaction(async (tx) => {
            const secrets = await this.active(tx, tenantId);
            this.txEventEmitter.emitAfterCommit(TenantEvents.WIDGET_SECRET_REVEALED, new TenantWidgetSecretRevealedEvent(tenantId, tenantId, userId));
            return { secrets };
        });
    }

    /**
     * Mints a new secret under a new `kid`; the one it replaces keeps verifying for 7 days and any older one is
     * retired. `tenant.widget_secret_rotated` tells Event Ingestion to drop its cached copy at once.
     */
    async rotate(tenantId: string, userId: string): Promise<WidgetSigningSecretsResponse> {
        const result = await this.prisma.$transaction(async (tx) => {
            const [current] = await this.stored(tx, tenantId);
            const next = this.vault.mint(new Date());
            await tx.tenant.update({ where: { id: tenantId }, data: { widgetSigningSecrets: this.vault.toColumn([next.stored, current!]) } });
            const secrets = this.activeOf([next.stored, current!]);
            const previousValidUntil = new Date(next.stored.created_at.getTime() + PREVIOUS_SECRET_GRACE_MS);
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.WIDGET_SECRET_ROTATED,
                new TenantWidgetSecretRotatedEvent(tenantId, tenantId, next.stored.kid, previousValidUntil, userId)
            );
            return { secrets };
        });
        this.logger.log('Widget signing secret rotated', { tenantId, kid: result.secrets[0]!.kid });
        return result;
    }

    /** Event Ingestion's read: the same active secrets, which it selects by the token's `kid`. */
    async forService(tenantId: string): Promise<WidgetSigningSecretsResponse> {
        return this.prisma.$transaction(async (tx) => ({ secrets: await this.active(tx, tenantId) }));
    }

    private async active(tx: Prisma.TransactionClient, tenantId: string): Promise<WidgetSigningSecretsResponse['secrets']> {
        return this.activeOf(await this.stored(tx, tenantId));
    }

    /** The newest secret has no end; the previous one verifies until 7 days after the newest was minted. */
    private activeOf(stored: StoredSigningSecret[]): WidgetSigningSecretsResponse['secrets'] {
        const [newest, previous] = stored;
        const secrets = [
            { kid: newest!.kid, secret: this.vault.open(newest!.secret_encrypted).raw, createdAt: newest!.created_at, expiresAt: null as Date | null }
        ];
        const previousUntil = new Date(newest!.created_at.getTime() + PREVIOUS_SECRET_GRACE_MS);
        if (previous && previousUntil.getTime() > Date.now()) {
            secrets.push({
                kid: previous.kid,
                secret: this.vault.open(previous.secret_encrypted).raw,
                createdAt: previous.created_at,
                expiresAt: previousUntil
            });
        }
        return secrets;
    }

    /** The stored entries, newest first, sealing any legacy plain value in place. */
    private async stored(tx: Prisma.TransactionClient, tenantId: string): Promise<StoredSigningSecret[]> {
        const row = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { widgetSigningSecrets: true } });
        if (!row) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }
        const stored = this.vault.parse(row.widgetSigningSecrets);
        if (stored.length === 0) {
            // 503, not an empty list: no reader may ever treat "no secret" as a secret.
            throw new ServiceUnavailableException(`Tenant ${tenantId} has no widget signing secret`);
        }
        if (stored.some((entry) => this.vault.open(entry.secret_encrypted).legacy)) {
            const sealed = stored.map((entry) => ({ ...entry, secret_encrypted: this.vault.seal(this.vault.open(entry.secret_encrypted).raw) }));
            await tx.tenant.update({ where: { id: tenantId }, data: { widgetSigningSecrets: this.vault.toColumn(sealed) } });
            return sealed;
        }
        return stored;
    }
}
