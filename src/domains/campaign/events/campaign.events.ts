import { BaseDomainEvent } from '@domains/common/events';

/**
 * Domain event emitted when a campaign is created
 */
export class CampaignCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'campaign.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly campaignId: string,
        public readonly tenantId: string,
        public readonly name: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a campaign is updated
 */
export class CampaignUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'campaign.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly campaignId: string,
        public readonly tenantId: string,
        public readonly changes: Record<string, unknown>,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a campaign invitation is sent
 */
export class CampaignInvitationSentEvent extends BaseDomainEvent {
    readonly eventType = 'campaign.invitation_sent' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly campaignId: string,
        public readonly tenantId: string,
        public readonly invitationId: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a campaign is activated
 */
export class CampaignActivatedEvent extends BaseDomainEvent {
    readonly eventType = 'campaign.activated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly campaignId: string,
        public readonly tenantId: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Campaign event type constants
 */
export const CampaignEvents = {
    CREATED: 'campaign.created',
    UPDATED: 'campaign.updated',
    INVITATION_SENT: 'campaign.invitation_sent',
    ACTIVATED: 'campaign.activated',
} as const;
