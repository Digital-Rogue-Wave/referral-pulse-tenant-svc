import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum } from 'class-validator';

import { BaseResponseMapper } from '@common/helper';
import { RoleEnum } from '@common/enums/role.enum';

// ============================================================
// Props (shape of the Prisma `users` model)
// ============================================================

export interface UserProps {
    id: string;
    tenantId: string;
    email: string;
    emailHash: string;
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

    /** The email and name are read from the Ory identity, never trusted from the request. */
    @ApiProperty({ enum: RoleEnum })
    @IsEnum(RoleEnum)
    role!: RoleEnum;
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

    @ApiProperty()
    email!: string;

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

    /** The email hash is an internal lookup key, not part of the API. */
    override toResponse(entity: UserProps): UserResponse {
        const { emailHash: _emailHash, ...visible } = entity;
        return super.toResponse(visible as UserProps);
    }
}

export const userResponseMapper = new UserResponseMapper();

// Re-export domain events
export * from './events/user.events';
