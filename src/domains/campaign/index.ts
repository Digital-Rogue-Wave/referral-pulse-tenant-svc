// ============================================================
// Campaign domain stub
//
// Campaign data lives in the campaign microservice.
// This module only provides event types and constants for
// consuming campaign events via SQS in this service.
// ============================================================

// ============================================================
// Event type constants
// ============================================================

export const CampaignEvents = {
    CREATED: 'campaign.created',
    UPDATED: 'campaign.updated',
    INVITATION_SENT: 'campaign.invitation_sent',
    ACTIVATED: 'campaign.activated',
} as const;

export type CampaignEventType = (typeof CampaignEvents)[keyof typeof CampaignEvents];

// ============================================================
// Event payload interfaces
// These are plain objects (not BaseDomainEvent subclasses)
// because they arrive as SQS message payloads from the
// campaign microservice, not from local event emission.
// ============================================================

export interface CampaignCreatedEvent {
    campaignId: string;
    tenantId: string;
    name?: string;
    createdAt?: string;
}

export interface CampaignUpdatedEvent {
    campaignId: string;
    tenantId: string;
    changes?: Record<string, unknown>;
    updatedAt?: string;
}

export interface CampaignInvitationSentEvent {
    campaignId: string;
    tenantId: string;
    invitationId: string;
    sentAt?: string;
}

export interface CampaignActivatedEvent {
    campaignId: string;
    tenantId: string;
    activatedAt?: string;
}
