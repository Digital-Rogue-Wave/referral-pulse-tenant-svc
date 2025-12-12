import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CancelDeletionDto {
    @ApiProperty({
        description: 'Password confirmation for security verification',
        example: 'SecurePassword123!'
    })
    @IsString()
    @IsNotEmpty()
    password: string;
}
