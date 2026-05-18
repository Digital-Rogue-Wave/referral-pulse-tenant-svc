import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { Tenant } from '@prisma-gen/generated/client';
import { PaymentStatusEnum } from '@common/enums/billing.enum';
import { TenantStatusEnum } from '@common/enums/tenant.enum';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

interface TenantPaymentStatusChangedEvent {
    tenantId: string;
    previousStatus: string | null;
    nextStatus: string;
    changedAt: string;
    source: string;
}

@Injectable()
export class PaymentStatusEscalationService {
    private static readonly PAST_DUE_TO_RESTRICTED_MS = 7 * 24 * 60 * 60 * 1000;
    private static readonly RESTRICTED_TO_LOCKED_MS = 14 * 24 * 60 * 60 * 1000;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly eventEmitter: EventEmitter2,
    ) {
        this.logger.setContext(PaymentStatusEscalationService.name);
    }

    async runEscalation(): Promise<void> {
        const now = new Date();

        const tenants = await this.prisma.tenant.findMany({
            where: {
                status: TenantStatusEnum.ACTIVE,
                paymentStatus: {
                    in: [PaymentStatusEnum.PAST_DUE, PaymentStatusEnum.RESTRICTED],
                },
                deletedAt: null,
            },
        });

        for (const tenant of tenants) {
            const changedAt = tenant.paymentStatusChangedAt;

            if (!changedAt) {
                await this.prisma.tenant.update({
                    where: { id: tenant.id },
                    data: { paymentStatusChangedAt: now },
                });
                continue;
            }

            const elapsedMs = now.getTime() - changedAt.getTime();

            if (tenant.paymentStatus === PaymentStatusEnum.PAST_DUE) {
                if (elapsedMs >= PaymentStatusEscalationService.PAST_DUE_TO_RESTRICTED_MS) {
                    await this.transition(tenant, PaymentStatusEnum.RESTRICTED, now);
                }
                continue;
            }

            if (tenant.paymentStatus === PaymentStatusEnum.RESTRICTED) {
                if (elapsedMs >= PaymentStatusEscalationService.RESTRICTED_TO_LOCKED_MS) {
                    await this.transition(tenant, PaymentStatusEnum.LOCKED, now);
                }
            }
        }
    }

    private async transition(tenant: Tenant, nextStatus: PaymentStatusEnum, now: Date): Promise<void> {
        const previousStatus = tenant.paymentStatus;

        if (previousStatus === nextStatus) {
            return;
        }

        await this.prisma.tenant.update({
            where: { id: tenant.id },
            data: {
                paymentStatus: nextStatus,
                paymentStatusChangedAt: now,
            },
        });

        this.logger.warn(
            `Escalated tenant paymentStatus: tenantId=${tenant.id}, from=${previousStatus}, to=${nextStatus}`,
        );

        const evt: TenantPaymentStatusChangedEvent = {
            tenantId: tenant.id,
            previousStatus,
            nextStatus,
            changedAt: now.toISOString(),
            source: 'escalation',
        };

        this.eventEmitter.emit('tenant.payment_status.changed', evt);
    }
}
