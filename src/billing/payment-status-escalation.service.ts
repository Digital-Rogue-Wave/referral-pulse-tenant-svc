import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { PaymentStatusEnum } from '@mod/common/enums/billing.enum';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { TenantPaymentStatusChangedEvent } from '@mod/common/interfaces/billing-events.interface';

@Injectable()
export class PaymentStatusEscalationService {
    private readonly logger = new Logger(PaymentStatusEscalationService.name);

    private static readonly PAST_DUE_TO_RESTRICTED_MS = 7 * 24 * 60 * 60 * 1000;
    private static readonly RESTRICTED_TO_LOCKED_MS = 14 * 24 * 60 * 60 * 1000;

    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async runEscalation(): Promise<void> {
        const now = new Date();

        const tenants = await this.tenantRepository.find({
            where: {
                status: TenantStatusEnum.ACTIVE,
                paymentStatus: In([PaymentStatusEnum.PAST_DUE, PaymentStatusEnum.RESTRICTED])
            }
        });

        for (const tenant of tenants) {
            const changedAt = tenant.paymentStatusChangedAt;

            if (!changedAt) {
                tenant.paymentStatusChangedAt = now;
                await this.tenantRepository.save(tenant);
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

    private async transition(tenant: TenantEntity, nextStatus: PaymentStatusEnum, now: Date): Promise<void> {
        const previousStatus = tenant.paymentStatus;

        if (previousStatus === nextStatus) {
            return;
        }

        tenant.paymentStatus = nextStatus;
        tenant.paymentStatusChangedAt = now;
        await this.tenantRepository.save(tenant);

        this.logger.warn(`Escalated tenant paymentStatus: tenantId=${tenant.id}, from=${previousStatus}, to=${nextStatus}`);

        const evt: TenantPaymentStatusChangedEvent = {
            tenantId: tenant.id,
            previousStatus,
            nextStatus,
            changedAt: now.toISOString(),
            source: 'escalation'
        };

        this.eventEmitter.emit('tenant.payment_status.changed', evt);
    }
}
