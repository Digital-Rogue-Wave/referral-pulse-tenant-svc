import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { RoleEnum } from '@common/enums/role.enum';
import { InvitationStatusEnum } from '@common/enums/invitation.enum';

import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Domain Events
// ============================================================

/**
 * Emitted when an invitation is created.
 * payload.email, payload.token, payload.tenantId, payload.role, payload.expiresAt
 * are used by EmailNotificationListener to send the invitation email.
 */
export class InvitationCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'invitation.created' as const;

    constructor(
        public readonly aggregateId: string, // invitationId
        public readonly tenantId: string,
        public readonly payload: {
            invitationId: string;
            tenantId: string;
            email: string;
            role: string;
            token: string;
            expiresAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Emitted when an invitation is resent (a fresh token is issued).
 * payload.email, payload.role, payload.token, payload.newExpiresAt are used by
 * EmailNotificationListener to send the resent invitation email.
 */
export class InvitationResentEvent extends BaseDomainEvent {
    readonly eventType = 'invitation.resent' as const;

    constructor(
        public readonly aggregateId: string, // invitationId
        public readonly tenantId: string,
        public readonly payload: {
            invitationId: string;
            tenantId: string;
            email: string;
            role: string;
            token: string;
            newExpiresAt: Date;
            resentAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export const InvitationEvents = {
    CREATED: 'invitation.created',
    RESENT: 'invitation.resent'
} as const;

// ============================================================
// Props (shape of the Prisma `invitations` model)
// ============================================================

export interface InvitationProps {
    id: string;
    tenantId: string;
    email: string;
    role: string;
    status: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}

// ============================================================
// DTOs
// ============================================================

export class CreateInvitationDto {
    @ApiProperty({ description: 'Email address of the person to invite' })
    @IsEmail()
    email!: string;

    @ApiProperty({ enum: RoleEnum, description: 'Role granted to the invitee on acceptance' })
    @IsEnum(RoleEnum)
    role!: RoleEnum;
}

// ============================================================
// Responses
// ============================================================

/** Tenant-facing invitation record. The token is never exposed here — it is delivered by email only. */
export class InvitationResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    email!: string;

    @ApiProperty({ enum: RoleEnum })
    role!: string;

    @ApiProperty({ enum: InvitationStatusEnum })
    status!: string;

    @ApiProperty()
    expiresAt!: Date;

    @ApiProperty()
    createdAt!: Date;
}

/** Public view returned from the token-validation endpoint (no token echoed back). */
export class PublicInvitationResponse {
    @ApiProperty()
    email!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: RoleEnum })
    role!: string;

    @ApiProperty({ enum: InvitationStatusEnum })
    status!: string;

    @ApiProperty()
    expiresAt!: Date;
}

// ============================================================
// Mappers
// ============================================================

class InvitationResponseMapper extends BaseResponseMapper<InvitationProps, InvitationResponse> {
    constructor() {
        super(InvitationResponse);
    }
}

class PublicInvitationResponseMapper extends BaseResponseMapper<InvitationProps, PublicInvitationResponse> {
    constructor() {
        super(PublicInvitationResponse);
    }
}

export const invitationResponseMapper = new InvitationResponseMapper();
export const publicInvitationResponseMapper = new PublicInvitationResponseMapper();
