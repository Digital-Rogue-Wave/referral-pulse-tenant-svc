export interface MemberRoleUpdatedEvent {
    memberId: string;
    userId: string;
    oldRole: string;
    newRole: string;
}
