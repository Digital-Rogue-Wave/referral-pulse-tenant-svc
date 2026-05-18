import { BaseDomainEvent } from '@domains/common/events/base-domain.event';
import type {
    TeamMemberCreatedPayload,
    TeamMemberRoleUpdatedPayload,
    TeamMemberRemovedPayload,
    TeamMemberStatusUpdatedPayload,
} from '../team-member.types';

/**
 * Event emitted when a team member is created
 */
export class TeamMemberCreatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('team-member', 'created');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: TeamMemberCreatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when a team member's role is updated
 */
export class TeamMemberRoleUpdatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('team-member', 'updated');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: TeamMemberRoleUpdatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when a team member is removed
 */
export class TeamMemberRemovedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('team-member', 'deleted');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: TeamMemberRemovedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event emitted when a team member's status is updated
 */
export class TeamMemberStatusUpdatedEvent extends BaseDomainEvent {
    readonly eventType = BaseDomainEvent.buildEventType('team-member', 'status');

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: TeamMemberStatusUpdatedPayload,
        public readonly userId?: string,
    ) {
        super();
    }
}
