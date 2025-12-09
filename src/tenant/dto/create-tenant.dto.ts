import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class CreateTenantDto {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsString()
    @IsOptional()
    @Matches(/^[a-z0-9-]+$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
    slug?: string;

    @IsString()
    @IsOptional()
    ownerId?: string;
}
