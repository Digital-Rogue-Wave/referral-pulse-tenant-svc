import type Stripe from 'stripe';

import { SubscriptionStatusEnum } from '@common/enums/billing.enum';

/**
 * Invoice fields the Stripe API still returns but the SDK v20+ types no longer declare.
 */
type InvoiceWithRuntimeFields = Stripe.Invoice & {
    payment_intent?: string | Stripe.PaymentIntent | null;
    subscription?: string | Stripe.Subscription | null;
};

/** The id of an expandable Stripe reference, whether it arrived as an id or as the expanded object. */
export const idOf = (ref: string | { id: string } | null | undefined): string | undefined => (typeof ref === 'string' ? ref : (ref?.id ?? undefined));

export interface InvoiceRefs {
    invoiceId: string;
    paymentIntentId: string | undefined;
    subscriptionId: string | undefined;
    customerId: string | undefined;
}

export function invoiceRefs(invoice: Stripe.Invoice): InvoiceRefs {
    const runtime = invoice as InvoiceWithRuntimeFields;
    return {
        invoiceId: invoice.id ?? '',
        paymentIntentId: idOf(runtime.payment_intent),
        subscriptionId: idOf(runtime.subscription),
        customerId: idOf(invoice.customer)
    };
}

/** In SDK v20+ the billing period lives on the subscription item. */
export function subscriptionPeriod(subscription: Stripe.Subscription): { start: Date | undefined; end: Date | undefined } {
    const item = subscription.items?.data?.[0];
    return {
        start: item?.current_period_start ? new Date(item.current_period_start * 1000) : undefined,
        end: item?.current_period_end ? new Date(item.current_period_end * 1000) : undefined
    };
}

/** Stripe subscription status → ours. `incomplete_expired` never became a subscription, so it is `canceled`. */
export function toSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatusEnum {
    switch (status) {
        case 'trialing':
            return SubscriptionStatusEnum.TRIALING;
        case 'active':
            return SubscriptionStatusEnum.ACTIVE;
        case 'past_due':
            return SubscriptionStatusEnum.PAST_DUE;
        case 'unpaid':
            return SubscriptionStatusEnum.UNPAID;
        case 'incomplete':
            return SubscriptionStatusEnum.INCOMPLETE;
        case 'paused':
            return SubscriptionStatusEnum.PAUSED;
        case 'canceled':
        case 'incomplete_expired':
            return SubscriptionStatusEnum.CANCELED;
        default: {
            const unknown: never = status;
            throw new Error(`Unknown Stripe subscription status ${String(unknown)}`);
        }
    }
}
