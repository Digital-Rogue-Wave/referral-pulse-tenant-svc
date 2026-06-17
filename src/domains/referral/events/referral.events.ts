import { BaseDomainEvent } from '@domains/common/events';

/**
 * Domain event emitted when a Referral conversion occurs
 */
export class ReferralConvertedEvent extends BaseDomainEvent {
    readonly eventType = 'referral.converted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly referrerId?: string,
        public readonly referredUserId?: string,
        public readonly conversionType?: string,
        public readonly conversionValue?: number,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Domain event emitted when a Referral is created
 */
export class ReferralCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'referral.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly referrerId: string,
        public readonly referralCode: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Domain event emitted when a Referral link is clicked
 */
export class ReferralClickedEvent extends BaseDomainEvent {
    readonly eventType = 'referral.clicked' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly referralCode: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Event type constants for convenience
 */
export const ReferralEvents = {
    CREATED: 'referral.created',
    CLICKED: 'referral.clicked',
    CONVERTED: 'referral.converted',
    REWARDED: 'referral.rewarded'
} as const;
