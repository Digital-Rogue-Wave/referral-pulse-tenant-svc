import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength, IsDateString } from 'class-validator';

export class LockTenantDto {
    @ApiProperty({
        description: 'Password confirmation for security verification',
        example: 'SecurePassword123!'
    })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    password: string;

    @ApiPropertyOptional({
        description: 'Optional reason for locking the account',
        example: 'Suspected unauthorized access'
    })
    @IsString()
    @IsOptional()
    reason?: string;

    @ApiPropertyOptional({
        description: 'Optional date and time when the account should be automatically unlocked',
        example: '2025-12-31T23:59:59.999Z'
    })
    @IsDateString()
    @IsOptional()
    lockUntil?: Date;
}
