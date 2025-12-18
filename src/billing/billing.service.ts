import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingEntity } from './billing.entity';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/tenant.enum';
import { SubscriptionCheckoutResponseDto } from './dto/subscription-checkout-response.dto';
import { StripeService } from './stripe.service';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';
import Stripe from 'stripe';
import { EventIdempotencyService } from '@mod/common/idempotency/event-idempotency.service';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { AuditService } from '@mod/common/audit/audit.service';
import { AuditAction } from '@mod/common/audit/audit-action.enum';

@Injectable()
export class BillingService {
	private readonly logger = new Logger(BillingService.name);
    constructor(
        @InjectRepository(BillingEntity)
        private readonly billingRepository: Repository<BillingEntity>,
        private readonly eventEmitter: EventEmitter2,
        private readonly stripeService: StripeService,
        private readonly cls: ClsService<ClsRequestContext>,
        private readonly eventIdempotency: EventIdempotencyService,
        private readonly metrics: MonitoringService,
        private readonly auditService: AuditService
    ) {}

    private getTenantIdFromContext(): string {
        const tenantId = this.cls.get('tenantId');
        if (!tenantId) {
            throw new Error('BillingService: tenantId missing in CLS context');
        }
        return tenantId as string;
    }

    private async getOrCreateBillingForTenant(tenantId: string): Promise<BillingEntity> {
        let billing = await this.billingRepository.findOne({ where: { tenantId } });
        if (!billing) {
            billing = this.billingRepository.create({
                tenantId,
                plan: BillingPlanEnum.FREE,
                status: SubscriptionStatusEnum.NONE
            });
            billing = await this.billingRepository.save(billing);
        }
        return billing;
    }

    private async getOrCreateBillingForCurrentTenant(): Promise<BillingEntity> {
        const tenantId = this.getTenantIdFromContext();
        return this.getOrCreateBillingForTenant(tenantId);
    }

    async subscriptionCheckout(plan: BillingPlanEnum): Promise<SubscriptionCheckoutResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        const session = await this.stripeService.createSubscriptionCheckoutSession({
            tenantId: billing.tenantId,
            plan
        });

        this.logger.log(
            `Created Stripe Checkout Session ${session.id} via BillingService for tenant ${billing.tenantId}, plan ${plan}`
        );

        return {
            plan,
            checkoutUrl: session.url ?? undefined,
            sessionId: session.id
        };
    }

    async handleStripeWebhook(rawBody: Buffer | string, signature: string): Promise<void> {
        let event: Stripe.Event;
        try {
            event = this.stripeService.constructWebhookEvent(rawBody, signature);
        } catch (err) {
            this.logger.error('Failed to construct Stripe webhook event', err as Error);
            this.metrics.incCounter('billing_subscription_events_total', { event: 'unknown', result: 'error' });
            throw err;
        }

        const eventId = event.id;
        const consumerName = 'stripe-webhook';

        this.logger.log(`Received Stripe webhook event ${event.type} (id=${eventId})`);

        if (eventId) {
            const alreadyProcessed = await this.eventIdempotency.isProcessed(eventId, consumerName);
            if (alreadyProcessed) {
                this.logger.warn(
                    `Stripe webhook event already processed - eventId: ${eventId}, type: ${event.type}, consumerName: ${consumerName}`
                );
                this.metrics.incCounter('billing_subscription_events_total', { event: event.type, result: 'duplicate' });
                return;
            }
        }

        let result: 'ok' | 'error' = 'ok';

        try {
            switch (event.type) {
                case 'checkout.session.completed': {
                    await this.handleCheckoutSessionCompleted(event);
                    break;
                }
                default:
                    this.logger.debug(`Ignoring unsupported Stripe event type: ${event.type}`);
            }
        } catch (err) {
            result = 'error';
            this.logger.error(
                `Error handling Stripe webhook event ${event.type} (id=${eventId ?? 'unknown'})`,
                err as Error
            );
            throw err;
        } finally {
            this.metrics.incCounter('billing_subscription_events_total', { event: event.type, result });

            if (eventId && result === 'ok') {
                await this.eventIdempotency.markProcessed(eventId, consumerName);
            }
        }
    }

    private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};
        const tenantId = metadata.tenantId as string | undefined;
        const planId = metadata.planId as BillingPlanEnum | undefined;

        if (!tenantId || !planId) {
            this.logger.warn('Stripe checkout.session.completed missing tenantId or planId metadata');
            return;
        }

        const billing = await this.getOrCreateBillingForTenant(tenantId);

        const previousPlan = billing.plan;
        const previousStatus = billing.status;
        const previousStripeCustomerId = billing.stripeCustomerId;
        const previousStripeSubscriptionId = billing.stripeSubscriptionId;

        if (planId === BillingPlanEnum.FREE) {
            billing.plan = BillingPlanEnum.FREE;
            billing.status = SubscriptionStatusEnum.NONE;
            billing.stripeCustomerId = (session.customer as string) ?? null;
            billing.stripeSubscriptionId = null;
            this.logger.log(
                `Processed checkout.session.completed for tenant ${tenantId}: plan=Free, status=None, customer=${billing.stripeCustomerId}`
            );
        } else {
            billing.plan = planId;
            billing.status = SubscriptionStatusEnum.ACTIVE;
            billing.stripeCustomerId = (session.customer as string) ?? null;
            billing.stripeSubscriptionId = (session.subscription as string) ?? null;
            this.logger.log(
                `Processed checkout.session.completed for tenant ${tenantId}: plan=${planId}, status=Active, customer=${billing.stripeCustomerId}, subscription=${billing.stripeSubscriptionId}`
            );
        }

        await this.billingRepository.save(billing);

        this.eventEmitter.emit('subscription.changed', {
            tenantId: billing.tenantId,
            billingPlan: billing.plan,
            subscriptionStatus: billing.status,
            stripeCustomerId: billing.stripeCustomerId,
            stripeSubscriptionId: billing.stripeSubscriptionId
        });

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            description: `Subscription updated via Stripe checkout to plan ${billing.plan} with status ${billing.status}`,
            metadata: {
                previousPlan,
                previousStatus,
                previousStripeCustomerId,
                previousStripeSubscriptionId,
                plan: billing.plan,
                status: billing.status,
                stripeCustomerId: billing.stripeCustomerId,
                stripeSubscriptionId: billing.stripeSubscriptionId,
                stripeEventId: event.id,
                stripeCheckoutSessionId: session.id
            }
        });
    }
}
