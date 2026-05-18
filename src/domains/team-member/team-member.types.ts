/**
 * Team Member Role constants
 */
export const TeamMemberRole = {
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    MEMBER: 'MEMBER',
} as const;

export type TeamMemberRoleType = (typeof TeamMemberRole)[keyof typeof TeamMemberRole];

/**
 * Team Member Status constants
 */
export const TeamMemberStatus = {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    INVITED: 'invited',
} as const;

export type TeamMemberStatusType = (typeof TeamMemberStatus)[keyof typeof TeamMemberStatus];

/**
 * Team Member props from Prisma
 */
export type TeamMemberProps = {
    id: string;
    userId: string;
    tenantId: string;
    role: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

/**
 * Team Member event payloads
 */
export type TeamMemberCreatedPayload = {
    memberId: string;
    userId: string;
    tenantId: string;
    role: string;
    createdAt: Date;
};

export type TeamMemberRoleUpdatedPayload = {
    memberId: string;
    userId: string;
    tenantId: string;
    oldRole: string;
    newRole: string;
    updatedBy: string;
    updatedAt: Date;
};

export type TeamMemberRemovedPayload = {
    memberId: string;
    userId: string;
    tenantId: string;
    removedBy: string;
    removedAt: Date;
};

export type TeamMemberStatusUpdatedPayload = {
    memberId: string;
    userId: string;
    tenantId: string;
    oldStatus: string;
    newStatus: string;
    updatedBy: string;
    updatedAt: Date;
};
