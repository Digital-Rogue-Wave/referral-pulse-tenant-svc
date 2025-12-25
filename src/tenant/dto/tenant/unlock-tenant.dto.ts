import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UnlockTenantDto {
    @ApiProperty({
        description: 'Password confirmation for security verification',
        example: 'SecurePassword123!'
    })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    password: string;
}
