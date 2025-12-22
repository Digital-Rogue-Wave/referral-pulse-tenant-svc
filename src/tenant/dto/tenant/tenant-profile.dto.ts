import { ApiProperty } from '@nestjs/swagger';
import { TenantDto } from './tenant.dto';

export class TenantProfileDto extends TenantDto {
    @ApiProperty({ description: 'Total number of team members' })
    memberCount: number;

    @ApiProperty({ description: 'Number of pending invitations' })
    pendingInvitationCount: number;

    @ApiProperty({ description: 'Number of active API keys' })
    activeApiKeyCount: number;
}
