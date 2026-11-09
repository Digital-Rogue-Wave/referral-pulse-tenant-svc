import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { WidgetSecretResponse, WidgetTokenSecretDto } from '@domains/tenant';
import { TenantEvents, TenantWidgetSecretRevealedEvent, TenantWidgetSecretRotatedEvent } from '@domains/tenant/events/tenant.events';

import { WidgetSecretVault } from './widget-secret.vault';

/** The longest a widget token lives (Product Spec §9), so the longest a replaced secret must keep working. */
const PREVIOUS_SECRET_GRACE_MS = 60 * 60 * 1_000;

type SecretColumns = { widgetTokenSecret: string | null; widgetTokenSecretPrevious: string | null; widgetTokenSecretPreviousUntil: Date | null };

const SECRET_COLUMNS = { widgetTokenSecret: true, widgetTokenSecretPrevious: true, widgetTokenSecretPreviousUntil: true } as const;

/**
 * The widget-token secret's three readers (US1.5.4): the Owner (read and rotate, both audited) and Event
 * Ingestion (service read). A legacy plain value is sealed the first time any of them touches it.
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

    /** The Owner's read (F2). Every read writes an audit row naming the reader. */
    async reveal(tenantId: string, userId: string): Promise<WidgetSecretResponse> {
        return this.prisma.$transaction(async (tx) => {
            const row = await this.load(tx, tenantId);
            const secret = await this.current(tx, tenantId, row);
            this.txEventEmitter.emitAfterCommit(TenantEvents.WIDGET_SECRET_REVEALED, new TenantWidgetSecretRevealedEvent(tenantId, tenantId, userId));
            return { secret, previousValidUntil: this.graceEnd(row) };
        });
    }

    /**
     * Replaces the secret (F3). The old one stays valid for an hour, so a client's backend can switch without
     * a broken widget; `tenant.widget_secret_rotated` tells Event Ingestion to drop its cached copy at once.
     */
    async rotate(tenantId: string, userId: string): Promise<WidgetSecretResponse> {
        const result = await this.prisma.$transaction(async (tx) => {
            const row = await this.load(tx, tenantId);
            const previous = await this.current(tx, tenantId, row);
            const next = this.vault.generate();
            const previousValidUntil = new Date(Date.now() + PREVIOUS_SECRET_GRACE_MS);
            await tx.tenant.update({
                where: { id: tenantId },
                data: {
                    widgetTokenSecret: next.sealed,
                    widgetTokenSecretPrevious: this.vault.seal(previous),
                    widgetTokenSecretPreviousUntil: previousValidUntil
                }
            });
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.WIDGET_SECRET_ROTATED,
                new TenantWidgetSecretRotatedEvent(tenantId, tenantId, previousValidUntil, userId)
            );
            return { secret: next.raw, previousValidUntil };
        });
        this.logger.log('Widget token secret rotated', { tenantId, previousValidUntil: result.previousValidUntil });
        return result;
    }

    /** Event Ingestion's read: the current secret, plus the previous one while it is still accepted. */
    async forService(tenantId: string): Promise<WidgetTokenSecretDto> {
        return this.prisma.$transaction(async (tx) => {
            const row = await this.load(tx, tenantId);
            const secret = await this.current(tx, tenantId, row);
            const previousValidUntil = this.graceEnd(row);
            if (!previousValidUntil || !row.widgetTokenSecretPrevious) {
                return { secret };
            }
            return { secret, previousSecret: this.vault.open(row.widgetTokenSecretPrevious).raw, previousValidUntil };
        });
    }

    private async load(tx: Prisma.TransactionClient, tenantId: string): Promise<SecretColumns> {
        const row = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: SECRET_COLUMNS });
        if (!row) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }
        return row;
    }

    /** The plain current secret, sealing a legacy plain value in place. */
    private async current(tx: Prisma.TransactionClient, tenantId: string, row: SecretColumns): Promise<string> {
        if (!row.widgetTokenSecret) {
            // 503, not an empty string: no reader may ever treat "no secret" as a secret.
            throw new ServiceUnavailableException(`Tenant ${tenantId} has no widget token secret`);
        }
        const { raw, legacy } = this.vault.open(row.widgetTokenSecret);
        if (legacy) {
            await tx.tenant.update({ where: { id: tenantId }, data: { widgetTokenSecret: this.vault.seal(raw) } });
        }
        return raw;
    }

    private graceEnd(row: SecretColumns): Date | null {
        const until = row.widgetTokenSecretPreviousUntil;
        return until && until.getTime() > Date.now() ? until : null;
    }
}
