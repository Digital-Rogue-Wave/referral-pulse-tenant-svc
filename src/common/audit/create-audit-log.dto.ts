import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, IsObject, IsIP } from 'class-validator';
import { AuditAction } from './audit-action.enum';

export class CreateAuditLogDto {
    @IsNotEmpty()
    @IsUUID()
    tenantId: string;

    @IsOptional()
    @IsUUID()
    userId?: string;

    @IsOptional()
    @IsString()
    userEmail?: string;

    @IsNotEmpty()
    @IsEnum(AuditAction)
    action: AuditAction;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;

    @IsOptional()
    @IsIP()
    ipAddress?: string;

    @IsOptional()
    @IsString()
    userAgent?: string;
}
