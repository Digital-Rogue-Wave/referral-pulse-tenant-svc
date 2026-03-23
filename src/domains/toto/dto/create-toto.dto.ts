import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTotoDto {
    @ApiProperty()
    @IsString()
    @MaxLength(255)
    name!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @IsIn(['active', 'inactive', 'archived'])
    status?: 'active' | 'inactive' | 'archived';
}
