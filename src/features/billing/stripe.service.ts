import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AllConfigType } from '@config/config.type';
import { BillingPlanEnum } from '@common/enums/billing.enum';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

/** Network retries the SDK makes itself; it sends an idempotency key with each retried write. */
const STRIPE_NETWORK_RETRIES = 2;
const STRIPE_TIMEOUT_MS = 20_000;

@Injectable()
export class StripeService {
    private client: Stripe | null = null;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
        private readonly context: TenantContextService
    ) {
        this.logger.setContext(StripeService.name);
    }

    private stripeClient(): Stripe {
        if (this.client) {
            return this.client;
        }
        const secretKey = this.configService.get('stripeConfig.secretKey', {
            infer: true
        });
        if (!secretKey) {
            throw new Error('Stripe secret key is not configured');
        }
        this.client = new Stripe(secretKey, { maxNetworkRetries: STRIPE_NETWORK_RETRIES, timeout: STRIPE_TIMEOUT_MS });
        return this.client;
    }

    /**
     * Idempotency for a Stripe write made on behalf of an API request: the request's own `Idempotency-Key`,
     * scoped by operation and subject. A client retrying its request can then never repeat the Stripe side
     * effect (a second checkout, a second proration invoice). Writes made outside a request rely on the SDK's
     * own retry keys.
     */
    private writeOptions(operation: string, subject: string): Stripe.RequestOptions | undefined {
        const requestKey = this.context.getIdempotencyKey();
        return requestKey ? { idempotencyKey: `${operation}:${subject}:${requestKey}`.slice(0, 255) } : undefined;
    }

    resolvePlanFromSubscription(subscription: Stripe.Subscription): BillingPlanEnum | null {
        const cfg = this.configService.get('stripeConfig', { infer: true });
        const items = subscription.items?.data ?? [];
        const firstItem = items[0];
        const priceId = firstItem?.price?.id ?? null;

        if (!priceId || !cfg) {
            return null;
        }

        if (cfg.freePriceId && priceId === cfg.freePriceId) {
            return BillingPlanEnum.FREE;
        }
        if (cfg.starterPriceId && priceId === cfg.starterPriceId) {
            return BillingPlanEnum.STARTER;
        }
        if (cfg.growthPriceId && priceId === cfg.growthPriceId) {
            return BillingPlanEnum.GROWTH;
        }
        if (cfg.enterprisePriceId && priceId === cfg.enterprisePriceId) {
            return BillingPlanEnum.ENTERPRISE;
        }

        return null;
    }

    async applyScheduledDowngrade(params: { stripeSubscriptionId: string; targetPlan: BillingPlanEnum }): Promise<void> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem) {
            throw new HttpException('Stripe subscription has no items to downgrade', HttpStatus.BAD_REQUEST);
        }

        const newPriceId = this.priceIdForPlan(params.targetPlan);

        await stripe.subscriptions.update(params.stripeSubscriptionId, {
            items: [
                {
                    id: firstItem.id,
                    price: newPriceId
                }
            ],
            proration_behavior: 'none',
            cancel_at_period_end: false
        });

        this.logger.log(
            `Applied scheduled downgrade for Stripe subscription ${params.stripeSubscriptionId} to plan ${params.targetPlan} (no proration)`
        );
    }

    async listActiveRecurringPricesWithProducts(): Promise<Stripe.Price[]> {
        const stripe = this.stripeClient();

        const prices: Stripe.Price[] = [];
        let startingAfter: string | undefined;

        // Paginate through all active recurring prices, expanding the related product
        // to have enough information for local plan sync.
        // NOTE: This intentionally does not filter by specific product IDs; consumers
        // of this method are expected to apply any domain-specific filtering.
        // The method is defensive against Stripe pagination and can be safely reused
        // by background jobs or admin-triggered sync flows.
        // Stripe API returns up to 100 items per page.
        // See: https://docs.stripe.com/api/prices/list
        while (true) {
            const page = await stripe.prices.list({
                active: true,
                limit: 100,
                expand: ['data.product'],
                ...(startingAfter ? { starting_after: startingAfter } : {})
            });

            prices.push(...page.data);

            if (!page.has_more) {
                break;
            }

            const last = page.data[page.data.length - 1];
            if (!last) {
                break;
            }
            startingAfter = last.id;
        }

        this.logger.log(`Fetched ${prices.length} active recurring Stripe prices for plan sync`);

        return prices;
    }

    private priceIdForPlan(plan: BillingPlanEnum): string {
        const cfg = this.configService.get('stripeConfig', { infer: true });

        switch (plan) {
            case BillingPlanEnum.FREE:
                if (!cfg?.freePriceId) {
                    throw new HttpException('Stripe Free price ID is not configured', HttpStatus.BAD_REQUEST);
                }
                return cfg.freePriceId;
            case BillingPlanEnum.STARTER:
                if (!cfg?.starterPriceId) {
                    throw new HttpException('Stripe Starter price ID is not configured', HttpStatus.BAD_REQUEST);
                }
                return cfg.starterPriceId;
            case BillingPlanEnum.GROWTH:
                if (!cfg?.growthPriceId) {
                    throw new HttpException('Stripe Growth price ID is not configured', HttpStatus.BAD_REQUEST);
                }
                return cfg.growthPriceId;
            case BillingPlanEnum.ENTERPRISE:
                if (!cfg?.enterprisePriceId) {
                    throw new HttpException('Stripe Enterprise price ID is not configured', HttpStatus.BAD_REQUEST);
                }
                return cfg.enterprisePriceId;
            default:
                throw new HttpException(`No Stripe price mapping for plan: ${plan}`, HttpStatus.BAD_REQUEST);
        }
    }

    /**
     * Checkout for a paid plan. The tenant's existing Stripe customer is reused (one customer per tenant), the
     * subscription carries the tenant id in its metadata, and with Stripe Tax on, the billing address and tax
     * ids are collected so VAT is computed.
     */
    async createSubscriptionCheckoutSession(params: {
        tenantId: string;
        plan: BillingPlanEnum;
        userId?: string;
        couponCode?: string;
        customerId?: string | null;
    }): Promise<{ id: string; url: string | null }> {
        const stripe = this.stripeClient();

        const successUrl = this.configService.get('stripeConfig.successUrl', {
            infer: true
        });
        const cancelUrl = this.configService.get('stripeConfig.cancelUrl', {
            infer: true
        });

        if (!successUrl || !cancelUrl) {
            throw new HttpException('Stripe success/cancel URLs are not configured', HttpStatus.BAD_REQUEST);
        }

        const priceId = this.priceIdForPlan(params.plan);

        let promotionCode: Stripe.PromotionCode | null = null;

        if (params.couponCode) {
            const promoList = await stripe.promotionCodes.list({
                code: params.couponCode,
                active: true,
                limit: 1
            });

            promotionCode = promoList.data[0] ?? null;

            if (!promotionCode) {
                throw new HttpException('Invalid or inactive coupon code', HttpStatus.BAD_REQUEST);
            }
        }

        const metadata: Record<string, string> = {
            tenantId: params.tenantId,
            planId: params.plan
        };

        if (params.userId) {
            metadata.userId = params.userId;
        }

        if (params.couponCode) {
            metadata.couponCode = params.couponCode;
        }

        const automaticTax = this.configService.get('stripeConfig.automaticTax', { infer: true }) === true;
        const session = await stripe.checkout.sessions.create(
            {
                mode: 'subscription',
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: successUrl,
                cancel_url: cancelUrl,
                client_reference_id: params.tenantId,
                metadata,
                subscription_data: { metadata: { tenantId: params.tenantId } },
                ...(params.customerId ? { customer: params.customerId } : {}),
                ...(automaticTax
                    ? {
                          automatic_tax: { enabled: true },
                          tax_id_collection: { enabled: true },
                          billing_address_collection: 'required' as const,
                          ...(params.customerId ? { customer_update: { address: 'auto' as const, name: 'auto' as const } } : {})
                      }
                    : {}),
                ...(promotionCode ? { discounts: [{ promotion_code: promotionCode.id }] } : {})
            },
            this.writeOptions('checkout', `${params.tenantId}:${params.plan}`)
        );

        this.logger.log(`Created Stripe Checkout Session ${session.id} for tenant ${params.tenantId}, plan ${params.plan}`);

        return { id: session.id, url: session.url };
    }

    /** The customer a charge belongs to (dispute events carry only the charge id). */
    async getChargeCustomerId(chargeId: string): Promise<string | undefined> {
        const charge = await this.stripeClient().charges.retrieve(chargeId);
        return typeof charge.customer === 'string' ? charge.customer : (charge.customer?.id ?? undefined);
    }

    async getSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
        const stripe = this.stripeClient();
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        this.logger.log(`Fetched Stripe subscription ${stripeSubscriptionId}`);
        return subscription;
    }

    async previewSubscriptionUpgrade(params: { stripeSubscriptionId: string; targetPlan: BillingPlanEnum }): Promise<{
        amountDueNow: number;
        currency: string;
        nextInvoiceDate: Date | null;
    }> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);

        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;

        if (!customerId) {
            throw new HttpException('Stripe subscription is missing customer for upgrade preview', HttpStatus.BAD_REQUEST);
        }

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem) {
            throw new HttpException('Stripe subscription has no items for upgrade preview', HttpStatus.BAD_REQUEST);
        }

        const newPriceId = this.priceIdForPlan(params.targetPlan);

        const upcoming = await stripe.invoices.createPreview({
            customer: customerId,
            subscription: params.stripeSubscriptionId,
            subscription_details: {
                items: [
                    {
                        id: firstItem.id,
                        price: newPriceId
                    }
                ]
            }
        });

        const amountDueNow = (upcoming.amount_due ?? 0) / 100;
        const currency = upcoming.currency ?? 'usd';
        const nextInvoiceDate = upcoming.next_payment_attempt ? this.dateService.fromUnix(upcoming.next_payment_attempt).toDate() : null;

        this.logger.log(
            `Calculated Stripe subscription upgrade preview for subscription ${params.stripeSubscriptionId} to plan ${params.targetPlan}: amountDueNow=${amountDueNow} ${currency}`
        );

        return { amountDueNow, currency, nextInvoiceDate };
    }

    async upgradeSubscription(params: { stripeSubscriptionId: string; targetPlan: BillingPlanEnum }): Promise<void> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem) {
            throw new HttpException('Stripe subscription has no items to upgrade', HttpStatus.BAD_REQUEST);
        }

        const newPriceId = this.priceIdForPlan(params.targetPlan);

        await stripe.subscriptions.update(
            params.stripeSubscriptionId,
            {
                items: [{ id: firstItem.id, price: newPriceId }],
                proration_behavior: 'always_invoice',
                payment_behavior: 'error_if_incomplete',
                cancel_at_period_end: false
            },
            this.writeOptions('upgrade', params.stripeSubscriptionId)
        );

        this.logger.log(`Upgraded Stripe subscription ${params.stripeSubscriptionId} to plan ${params.targetPlan} with proration`);
    }

    async scheduleSubscriptionDowngrade(params: {
        stripeSubscriptionId: string;
        targetPlan: BillingPlanEnum;
    }): Promise<{ effectiveDate: Date | null }> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);
        const periodEndRaw = subscription.items?.data?.[0]?.current_period_end;
        const periodEndTs = typeof periodEndRaw === 'number' && Number.isFinite(periodEndRaw) ? periodEndRaw : null;
        const effectiveDate = periodEndTs ? this.dateService.fromUnix(periodEndTs).toDate() : null;

        if (!periodEndTs) {
            this.logger.warn(
                `Unable to schedule downgrade in Stripe because current_period_end is missing for subscription ${params.stripeSubscriptionId}`
            );
            return { effectiveDate: null };
        }

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem?.price?.id) {
            throw new HttpException('Stripe subscription has no price information to schedule downgrade', HttpStatus.BAD_REQUEST);
        }

        const currentPriceId = firstItem.price.id;
        const currentQuantity = firstItem.quantity ?? 1;
        const newPriceId = this.priceIdForPlan(params.targetPlan);

        const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id;

        const schedule = scheduleId
            ? await stripe.subscriptionSchedules.retrieve(scheduleId)
            : await stripe.subscriptionSchedules.create(
                  { from_subscription: params.stripeSubscriptionId },
                  this.writeOptions('downgrade-schedule', params.stripeSubscriptionId)
              );

        const startDate = schedule.phases?.[0]?.start_date ?? subscription.created;

        await stripe.subscriptionSchedules.update(
            schedule.id,
            {
                end_behavior: 'release',
                phases: [
                    { start_date: startDate, end_date: periodEndTs, items: [{ price: currentPriceId, quantity: currentQuantity }] },
                    { start_date: periodEndTs, items: [{ price: newPriceId, quantity: currentQuantity }] }
                ]
            },
            this.writeOptions('downgrade', `${schedule.id}:${params.targetPlan}`)
        );

        this.logger.log(
            `Scheduled Stripe subscription ${params.stripeSubscriptionId} to downgrade to plan ${params.targetPlan} at ${
                effectiveDate ? this.dateService.toISO(effectiveDate) : 'unknown'
            } using schedule ${schedule.id}`
        );

        return { effectiveDate };
    }

    async cancelPendingSubscriptionDowngrade(stripeSubscriptionId: string): Promise<void> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id;

        if (!scheduleId) {
            this.logger.log(`No Stripe schedule found to cancel downgrade for subscription ${stripeSubscriptionId}`);
            return;
        }

        await stripe.subscriptionSchedules.release(scheduleId, {}, this.writeOptions('downgrade-release', scheduleId));
        this.logger.log(`Released Stripe subscription schedule ${scheduleId} for subscription ${stripeSubscriptionId}`);
    }

    async scheduleSubscriptionCancellation(stripeSubscriptionId: string): Promise<{ effectiveDate: Date | null }> {
        const stripe = this.stripeClient();

        const existing = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const existingScheduleId = typeof existing.schedule === 'string' ? existing.schedule : existing.schedule?.id;

        if (existingScheduleId) {
            await stripe.subscriptionSchedules.release(existingScheduleId, {}, this.writeOptions('cancel-release', existingScheduleId));
            this.logger.log(
                `Released Stripe subscription schedule ${existingScheduleId} before scheduling cancellation for subscription ${stripeSubscriptionId}`
            );
        }

        const subscription = await stripe.subscriptions.update(
            stripeSubscriptionId,
            { cancel_at_period_end: true },
            this.writeOptions('cancel', stripeSubscriptionId)
        );

        const periodEndRaw = subscription.items?.data?.[0]?.current_period_end;
        const periodEndTs = typeof periodEndRaw === 'number' && Number.isFinite(periodEndRaw) ? periodEndRaw : null;
        const periodEnd = periodEndTs ? this.dateService.fromUnix(periodEndTs).toDate() : null;

        this.logger.log(
            `Scheduled subscription cancellation at period end for Stripe subscription ${stripeSubscriptionId} with effective date ${
                periodEnd ? this.dateService.toISO(periodEnd) : 'unknown'
            }`
        );

        return { effectiveDate: periodEnd };
    }

    async reactivateSubscription(stripeSubscriptionId: string): Promise<void> {
        const stripe = this.stripeClient();

        await stripe.subscriptions.update(
            stripeSubscriptionId,
            { cancel_at_period_end: false },
            this.writeOptions('reactivate', stripeSubscriptionId)
        );

        this.logger.log(`Reactivated Stripe subscription ${stripeSubscriptionId} by clearing cancel_at_period_end`);
    }

    /**
     * Ends a subscription now, without a refund or a final prorated invoice. Idempotent: a subscription that
     * has already ended is left as it is, so a retried deletion does not fail on it.
     */
    async cancelSubscriptionNow(stripeSubscriptionId: string): Promise<void> {
        const stripe = this.stripeClient();
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
            return;
        }
        await stripe.subscriptions.cancel(stripeSubscriptionId, {}, { idempotencyKey: `tenant-deletion:${stripeSubscriptionId}` });
        this.logger.log(`Canceled Stripe subscription ${stripeSubscriptionId}`);
    }

    constructWebhookEvent(payload: Buffer | string, signature: string): Stripe.Event {
        const stripe = this.stripeClient();
        const cfg = this.configService.get('stripeConfig', { infer: true });
        const webhookSecret = cfg?.webhookSecret as string | undefined;
        if (!webhookSecret) {
            throw new HttpException('Stripe webhook secret is not configured', HttpStatus.BAD_REQUEST);
        }

        return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    }

    async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
        const stripe = this.stripeClient();

        const setupIntent = await stripe.setupIntents.create(
            { customer: customerId, usage: 'off_session', payment_method_types: ['card'] },
            this.writeOptions('setup-intent', customerId)
        );

        this.logger.log(`Created Stripe SetupIntent ${setupIntent.id} for customer ${customerId}`);

        return setupIntent;
    }

    async listPaymentMethods(customerId: string): Promise<
        {
            id: string;
            brand: string | null;
            last4: string | null;
            expMonth: number | null;
            expYear: number | null;
            isDefault: boolean;
        }[]
    > {
        const stripe = this.stripeClient();

        const customer = await stripe.customers.retrieve(customerId);
        const defaultPm = !customer.deleted ? customer.invoice_settings?.default_payment_method : undefined;
        const defaultPaymentMethodId = typeof defaultPm === 'string' ? defaultPm : (defaultPm?.id ?? null);

        const list = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card',
            limit: 100
        });

        this.logger.log(`Listed ${list.data.length} Stripe payment methods for customer ${customerId}, default=${defaultPaymentMethodId ?? 'none'}`);

        return list.data.map((pm) => {
            const card = pm.card;
            return {
                id: pm.id,
                brand: card?.brand ?? null,
                last4: card?.last4 ?? null,
                expMonth: card?.exp_month ?? null,
                expYear: card?.exp_year ?? null,
                isDefault: pm.id === defaultPaymentMethodId
            };
        });
    }

    async detachPaymentMethodForCustomer(customerId: string, paymentMethodId: string): Promise<void> {
        const stripe = this.stripeClient();

        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        const pmCustomer = pm.customer;
        const pmCustomerId = typeof pmCustomer === 'string' ? pmCustomer : (pmCustomer?.id ?? null);

        if (pmCustomerId !== customerId) {
            throw new HttpException('Payment method not found for this customer', HttpStatus.NOT_FOUND);
        }

        await stripe.paymentMethods.detach(paymentMethodId, {}, this.writeOptions('detach', paymentMethodId));

        this.logger.log(`Detached Stripe payment method ${paymentMethodId} from customer ${customerId}`);
    }

    async setDefaultPaymentMethodForCustomer(customerId: string, paymentMethodId: string): Promise<void> {
        const stripe = this.stripeClient();

        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        const pmCustomer = pm.customer;
        const pmCustomerId = typeof pmCustomer === 'string' ? pmCustomer : (pmCustomer?.id ?? null);

        if (pmCustomerId !== customerId) {
            throw new HttpException('Payment method not found for this customer', HttpStatus.NOT_FOUND);
        }

        await stripe.customers.update(
            customerId,
            { invoice_settings: { default_payment_method: paymentMethodId } },
            this.writeOptions('default-payment-method', `${customerId}:${paymentMethodId}`)
        );

        this.logger.log(`Set default payment method ${paymentMethodId} for customer ${customerId}`);
    }

    /** One page of invoices, newest first, paged with Stripe's own cursors (invoice ids). */
    async listInvoicesForCustomer(
        customerId: string,
        page: { limit: number; startingAfter?: string; endingBefore?: string }
    ): Promise<{
        hasMore: boolean;
        data: {
            id: string;
            number: string | null;
            status: string | null;
            currency: string;
            amountDue: number;
            amountPaid: number;
            createdAt: Date;
            periodStart: Date | null;
            periodEnd: Date | null;
            hostedInvoiceUrl: string | null;
            invoicePdfUrl: string | null;
        }[];
    }> {
        const stripe = this.stripeClient();

        const list = await stripe.invoices.list({
            customer: customerId,
            limit: page.limit,
            ...(page.startingAfter ? { starting_after: page.startingAfter } : {}),
            ...(page.endingBefore && !page.startingAfter ? { ending_before: page.endingBefore } : {})
        });

        const data = list.data.map((invoice) => {
            const createdTs = invoice.created ?? 0;
            const periodStartTs = invoice.period_start as number | undefined;
            const periodEndTs = invoice.period_end as number | undefined;

            return {
                id: invoice.id,
                number: invoice.number ?? null,
                status: invoice.status ?? null,
                currency: invoice.currency ?? 'usd',
                amountDue: (invoice.amount_due ?? 0) / 100,
                amountPaid: (invoice.amount_paid ?? 0) / 100,
                createdAt: this.dateService.fromUnix(createdTs).toDate(),
                periodStart: periodStartTs ? this.dateService.fromUnix(periodStartTs).toDate() : null,
                periodEnd: periodEndTs ? this.dateService.fromUnix(periodEndTs).toDate() : null,
                hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
                invoicePdfUrl: invoice.invoice_pdf ?? null
            };
        });
        return { hasMore: list.has_more, data };
    }

    /**
     * A Stripe Customer Portal session: the Owner manages cards, billing address, tax ids and downloads
     * invoices on Stripe's hosted page. Returns the one-time URL.
     */
    async createPortalSession(customerId: string): Promise<string> {
        const returnUrl = this.configService.get('stripeConfig.portalReturnUrl', { infer: true });
        if (!returnUrl) {
            throw new HttpException('Stripe portal return URL is not configured', HttpStatus.SERVICE_UNAVAILABLE);
        }
        const session = await this.stripeClient().billingPortal.sessions.create(
            { customer: customerId, return_url: returnUrl },
            this.writeOptions('portal', customerId)
        );
        return session.url;
    }

    async retrieveUpcomingInvoiceForCustomer(params: { customerId: string; subscriptionId?: string | null }): Promise<{
        amountDue: number;
        currency: string;
        nextPaymentAttempt: Date | null;
        periodStart: Date | null;
        periodEnd: Date | null;
    }> {
        const stripe = this.stripeClient();

        const upcoming = await stripe.invoices.createPreview({
            customer: params.customerId,
            ...(params.subscriptionId
                ? {
                      subscription: params.subscriptionId
                  }
                : {})
        });

        const amountDue = (upcoming.amount_due ?? 0) / 100;
        const currency = upcoming.currency ?? 'usd';

        const nextPaymentAttempt = upcoming.next_payment_attempt ? this.dateService.fromUnix(upcoming.next_payment_attempt).toDate() : null;

        const periodStartTs = upcoming.period_start as number | undefined;
        const periodEndTs = upcoming.period_end as number | undefined;

        const periodStart = periodStartTs ? this.dateService.fromUnix(periodStartTs).toDate() : null;
        const periodEnd = periodEndTs ? this.dateService.fromUnix(periodEndTs).toDate() : null;

        this.logger.log(
            `Retrieved upcoming Stripe invoice preview for customer ${params.customerId} (subscription=${
                params.subscriptionId ?? 'none'
            }): amountDue=${amountDue} ${currency}`
        );

        return {
            amountDue,
            currency,
            nextPaymentAttempt,
            periodStart,
            periodEnd
        };
    }
}
