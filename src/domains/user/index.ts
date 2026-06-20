import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsEmail } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { RoleEnum } from '@common/enums/role.enum';

// ============================================================
// Props (shape of the Prisma `users` model)
// ============================================================

export interface UserProps {
    id: string;
    tenantId: string;
    email?: string | null;
    name?: string | null;
    role: string;
    kratosIdentityId: string;
    lastLoginAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}

// ============================================================
// DTOs
// ============================================================

export class AddUserDto {
    @ApiProperty({ description: 'Ory Kratos identity id of the platform user' })
    @IsString()
    kratosIdentityId!: string;

    @ApiProperty({ enum: RoleEnum })
    @IsEnum(RoleEnum)
    role!: RoleEnum;

    @ApiPropertyOptional()
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    name?: string;
}

export class UpdateUserRoleDto {
    @ApiProperty({ enum: RoleEnum })
    @IsEnum(RoleEnum)
    role!: RoleEnum;
}

// ============================================================
// Responses
// ============================================================

export class UserResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiPropertyOptional()
    email?: string | null;

    @ApiPropertyOptional()
    name?: string | null;

    @ApiProperty({ enum: RoleEnum })
    role!: string;

    @ApiProperty()
    kratosIdentityId!: string;

    @ApiPropertyOptional()
    lastLoginAt?: Date | null;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    @ApiPropertyOptional()
    deletedAt?: Date | null;
}

class UserResponseMapper extends BaseResponseMapper<UserProps, UserResponse> {
    constructor() {
        super(UserResponse);
    }
}

export const userResponseMapper = new UserResponseMapper();

// Re-export domain events
export * from './events/user.events';
