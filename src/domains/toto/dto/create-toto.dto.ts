import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';

export class CreateTotoDto {
    @IsString()
    @MaxLength(255)
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    @IsIn(['active', 'inactive', 'archived'])
    status?: 'active' | 'inactive' | 'archived';
}