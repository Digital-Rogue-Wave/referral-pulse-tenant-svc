/**
 * Invitation Status constants
 */
export const InvitationStatus = {
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    EXPIRED: 'EXPIRED',
    REVOKED: 'REVOKED',
    REJECTED: 'REJECTED',
} as const;

export type InvitationStatusType = (typeof InvitationStatus)[keyof typeof InvitationStatus];

/**
 * Invitation Role constants (same as TeamMemberRole)
 */
export const InvitationRole = {
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    MEMBER: 'MEMBER',
} as const;

export type InvitationRoleType = (typeof InvitationRole)[keyof typeof InvitationRole];

/**
 * Invitation props from Prisma
 */
export type InvitationProps = {
    id: string;
    tenantId: string;
    email: string;
    role: string;
    status: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

/**
 * Invitation event payloads
 */
export type InvitationCreatedPayload = {
    invitationId: string;
    tenantId: string;
    email: string;
    role: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
};

export type InvitationAcceptedPayload = {
    invitationId: string;
    tenantId: string;
    email: string;
    role: string;
    userId: string;
    acceptedAt: Date;
};

export type InvitationRevokedPayload = {
    invitationId: string;
    tenantId: string;
    email: string;
    revokedBy: string;
    revokedAt: Date;
};

export type InvitationRejectedPayload = {
    invitationId: string;
    tenantId: string;
    email: string;
    rejectedAt: Date;
};

export type InvitationExpiredPayload = {
    invitationId: string;
    tenantId: string;
    email: string;
    expiredAt: Date;
};

export type InvitationResentPayload = {
    invitationId: string;
    tenantId: string;
    email: string;
    newExpiresAt: Date;
    resentAt: Date;
};
