export interface InvitationCreatedEvent {
    invitationId: string;
    email: string;
    token: string;
    tenantName: string;
}

export interface MemberJoinedEvent {
    userId: string;
    tenantId: string;
    role: string;
    invitationId: string;
}
