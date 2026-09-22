import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AllConfigType } from '@config/config.type';
import { PaymentStatusEnum } from '@common/enums/billing.enum';
import { TenantStatus } from '@domains/tenant/tenant.types';
import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BillingEvents, TenantPaymentStatusChangedEvent } from '@domains/billing';

const DAY_MS = 86_400_000;

/**
 * Dunning: a tenant whose payment keeps failing goes `past_due` → `restricted` → `locked` after the
 * configured number of days in each state (`BILLING_DUNNING_*`). A payment restores it through the Stripe
 * webhook. Each step is a compare-and-set on the status it escalates from, committed with its event, so a
 * payment arriving during the run is never overwritten.
 */
@Injectable()
export class PaymentStatusEscalationService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly config: ConfigService<AllConfigType>
    ) {
        this.logger.setContext(PaymentStatusEscalationService.name);
    }

    async runEscalation(now = new Date()): Promise<void> {
        const billing = this.config.get('billingConfig', { infer: true });
        const steps: Array<{ from: PaymentStatusEnum; to: PaymentStatusEnum; afterDays: number }> = [
            { from: PaymentStatusEnum.PAST_DUE, to: PaymentStatusEnum.RESTRICTED, afterDays: billing?.dunningRestrictAfterDays ?? 7 },
            { from: PaymentStatusEnum.RESTRICTED, to: PaymentStatusEnum.LOCKED, afterDays: billing?.dunningLockAfterDays ?? 14 }
        ];
        for (const step of steps) {
            const due = await this.prisma.tenant.findMany({
                where: {
                    status: { not: TenantStatus.CLOSED },
                    deletedAt: null,
                    paymentStatus: step.from,
                    OR: [{ paymentStatusChangedAt: null }, { paymentStatusChangedAt: { lte: new Date(now.getTime() - step.afterDays * DAY_MS) } }]
                },
                select: { id: true, paymentStatusChangedAt: true }
            });
            for (const tenant of due) {
                await (tenant.paymentStatusChangedAt
                    ? this.escalate(tenant.id, step.from, step.to, now)
                    : this.startClock(tenant.id, step.from, now));
            }
        }
    }

    /** A status set without a timestamp starts its clock now instead of escalating at once. */
    private async startClock(tenantId: string, status: PaymentStatusEnum, now: Date): Promise<void> {
        await this.prisma.tenant.updateMany({
            where: { id: tenantId, paymentStatus: status, paymentStatusChangedAt: null },
            data: { paymentStatusChangedAt: now }
        });
    }

    private async escalate(tenantId: string, from: PaymentStatusEnum, to: PaymentStatusEnum, now: Date): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const { count } = await tx.tenant.updateMany({
                where: { id: tenantId, paymentStatus: from },
                data: { paymentStatus: to, paymentStatusChangedAt: now }
            });
            if (count === 0) {
                return;
            }
            this.txEventEmitter.emitAfterCommit(
                BillingEvents.TENANT_PAYMENT_STATUS_CHANGED,
                new TenantPaymentStatusChangedEvent(tenantId, tenantId, from, to, now.toISOString(), 'dunning')
            );
        });
        this.logger.warn('Dunning escalated a tenant', { tenantId, from, to });
    }
}
