import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SuspendTenantDto {
    @ApiProperty({
        description: 'Reason for tenant suspension',
        example: 'Violation of terms of service'
    })
    @IsString()
    @IsOptional()
    reason?: string;
}
