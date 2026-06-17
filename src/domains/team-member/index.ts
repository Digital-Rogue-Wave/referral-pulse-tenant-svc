import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Enums
// ============================================================

export enum TeamMemberRole {
    OWNER = 'OWNER',
    ADMIN = 'ADMIN',
    MEMBER = 'MEMBER'
}

export enum TeamMemberStatus {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
    SUSPENDED = 'SUSPENDED'
}

// ============================================================
// Props (shape of the Prisma model)
// ============================================================

export interface TeamMemberProps {
    id: string;
    userId: string;
    tenantId: string;
    role: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}

// ============================================================
// DTOs
// ============================================================

export class CreateTeamMemberDto {
    @ApiProperty()
    @IsString()
    userId!: string;

    @ApiProperty({ enum: TeamMemberRole })
    @IsEnum(TeamMemberRole)
    role!: string;

    @ApiPropertyOptional({ enum: TeamMemberStatus })
    @IsOptional()
    @IsEnum(TeamMemberStatus)
    status?: string;
}

export class UpdateTeamMemberDto {
    @ApiPropertyOptional({ enum: TeamMemberRole })
    @IsOptional()
    @IsEnum(TeamMemberRole)
    role?: string;

    @ApiPropertyOptional({ enum: TeamMemberStatus })
    @IsOptional()
    @IsEnum(TeamMemberStatus)
    status?: string;
}

// ============================================================
// Responses
// ============================================================

export class TeamMemberResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    userId!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: TeamMemberRole })
    role!: string;

    @ApiProperty({ enum: TeamMemberStatus })
    status!: string;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    @ApiPropertyOptional()
    deletedAt?: Date | null;
}

// ============================================================
// Mapper
// ============================================================

class TeamMemberResponseMapper extends BaseResponseMapper<TeamMemberProps, TeamMemberResponse> {
    constructor() {
        super(TeamMemberResponse);
    }
}

export const teamMemberResponseMapper = new TeamMemberResponseMapper();

// ============================================================
// Domain Events
// ============================================================

export class TeamMemberCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'team-member.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            memberId: string;
            userId: string;
            tenantId: string;
            role: string;
            createdAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export class TeamMemberRoleUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'team-member.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            memberId: string;
            userId: string;
            tenantId: string;
            oldRole: string;
            newRole: string;
            updatedBy: string;
            updatedAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export class TeamMemberStatusUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'team-member.status' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            memberId: string;
            userId: string;
            tenantId: string;
            oldStatus: string;
            newStatus: string;
            updatedBy: string;
            updatedAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export class TeamMemberRemovedEvent extends BaseDomainEvent {
    readonly eventType = 'team-member.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            memberId: string;
            userId: string;
            tenantId: string;
            removedBy: string;
            removedAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export const TeamMemberEvents = {
    CREATED: 'team-member.created',
    UPDATED: 'team-member.updated',
    STATUS: 'team-member.status',
    DELETED: 'team-member.deleted'
} as const;
