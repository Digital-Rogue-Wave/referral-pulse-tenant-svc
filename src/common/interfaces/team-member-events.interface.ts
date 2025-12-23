export interface MemberRoleUpdatedEvent {
    memberId: string;
    userId: string;
    oldRole: string;
    newRole: string;
}
export interface MemberRemovedEvent {
    memberId: string;
    userId: string;
    tenantId: string;
}
