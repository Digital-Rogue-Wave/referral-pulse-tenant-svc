import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class ScheduleDeletionDto {
    @ApiProperty({
        description: 'Password confirmation for security verification',
        example: 'SecurePassword123!'
    })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    password: string;

    @ApiPropertyOptional({
        description: 'Optional reason for deletion',
        example: 'No longer need the service'
    })
    @IsString()
    @IsOptional()
    reason?: string;
}
