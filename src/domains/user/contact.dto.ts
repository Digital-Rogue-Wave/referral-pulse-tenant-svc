import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { RoleEnum } from '@common/enums/role.enum';

import { InvitationChannel } from '@domains/tenant/tenant.types';

/**
 * An operator's delivery address, for notification-service to resolve at send time (events never carry
 * addresses). Only live operators are returned: a removed or erased operator is not found.
 */
export class OperatorContactResponse {
    @ApiProperty()
    userId!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    email!: string;

    @ApiPropertyOptional({ nullable: true, type: String })
    name!: string | null;

    @ApiProperty({ enum: ['owner', 'admin', 'operator', 'viewer'] })
    role!: string;
}

export class ContactQueryDto {
    @ApiPropertyOptional({ enum: RoleEnum, description: 'Only operators with this role, e.g. OWNER for billing mail' })
    @IsOptional()
    @IsEnum(RoleEnum)
    role?: RoleEnum;
}

/**
 * What notification-service needs to address mail on a tenant's behalf: the brand shown to recipients,
 * the default locale, the client-app link emails point to (API §7.1: emails link to the client's own
 * app, never to a platform page) and a reply-to. The last three come from the tenant's `general`
 * settings (`locale`, `app_url`, `support_email`) and are null when unset or malformed.
 */
export class TenantCommunicationProfileResponse {
    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ description: 'Brand name shown to recipients' })
    name!: string;

    @ApiProperty({ enum: ['active', 'suspended', 'locked', 'closed'] })
    status!: string;

    @ApiPropertyOptional({ nullable: true, type: String, example: 'de-DE' })
    locale!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String, example: 'https://app.client.com/referrals' })
    appUrl!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String })
    replyTo!: string | null;

    /**
     * R-PRT-02's effective legal envelope for platform-sent invitations: the Owner's explicit choice
     * or, where they made none, the platform default derived from the billing country. Resolved here
     * so no consumer re-derives the jurisdiction rule.
     */
    @ApiProperty({ enum: InvitationChannel, description: 'Whether the platform may send invitations for this tenant' })
    invitationChannel!: InvitationChannel;
}