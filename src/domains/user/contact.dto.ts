import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { RoleEnum } from '@common/enums/role.enum';

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
