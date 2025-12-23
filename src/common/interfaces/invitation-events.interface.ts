export interface InvitationCreatedEvent {
    invitationId: string;
    email: string;
    token: string;
    tenantId: string;
    tenantName: string;
}

export interface MemberInvitedEvent {
    invitationId: string;
    email: string;
    tenantId: string;
    role: string;
    expiresAt: string;
}

export interface MemberJoinedEvent {
    userId: string;
    tenantId: string;
    role: string;
    invitationId: string;
}
