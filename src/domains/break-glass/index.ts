import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength, MinLength } from 'class-validator';

/** `POST /v1/admin/break-glass` (E1 D17): a Super Admin asks for time-boxed read access to one tenant. */
export class OpenBreakGlassDto {
    @ApiProperty({ description: 'The tenant whose data is needed' })
    @IsString()
    @Length(1, 26)
    tenantId!: string;

    @ApiProperty({ description: 'Why the access is needed — kept on every audit row of the window', minLength: 10, maxLength: 500 })
    @IsString()
    @MinLength(10)
    @MaxLength(500)
    reason!: string;
}

export class BreakGlassResponse {
    @ApiProperty()
    tenantId!: string;

    @ApiProperty()
    reason!: string;

    @ApiProperty()
    openedAt!: string;

    @ApiProperty({ description: 'When access ends on its own' })
    expiresAt!: string;
}

/** An open window, as kept in Redis until it expires. */
export interface BreakGlassGrant {
    grantId: string;
    staffIdentityId: string;
    tenantId: string;
    reason: string;
    openedAt: string;
    expiresAt: string;
}

/** The header the platform console sends to act inside an open window, through the gateway's token exchange. */
export const BREAK_GLASS_TENANT_HEADER = 'x-break-glass-tenant';
