import { IsBoolean, IsOptional, IsEmail, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NotificationSettingsDto {
    @ApiProperty({ example: true, description: 'Enable email notifications', required: false })
    @IsOptional()
    @IsBoolean()
    emailEnabled?: boolean;

    @ApiProperty({ example: false, description: 'Enable webhook notifications', required: false })
    @IsOptional()
    @IsBoolean()
    webhookEnabled?: boolean;

    @ApiProperty({ example: ['admin@example.com'], description: 'List of alert recipient emails', required: false })
    @IsOptional()
    @IsArray()
    @IsEmail({}, { each: true })
    alertRecipients?: string[];
}
