export interface MemberRoleUpdatedEvent {
    memberId: string;
    userId: string;
    oldRole: string;
    newRole: string;
    ipAddress: string;
    userAgent: string;
}
export interface MemberRemovedEvent {
    memberId: string;
    userId: string;
    tenantId: string;
    ipAddress: string;
    userAgent: string;
}
