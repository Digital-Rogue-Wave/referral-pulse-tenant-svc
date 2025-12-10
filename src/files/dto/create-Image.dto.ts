import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImageDto {
    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The unique identifier for the image.',
        format: 'uuid'
    })
    id: string;

    @IsString()
    @ApiProperty({ description: 'The path or URL of the image.' })
    path: string;
}
