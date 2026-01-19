import { IsNotEmpty, IsString, IsUUID, IsObject, IsDateString, IsOptional } from 'class-validator';

export class PublishSnsEventDto {
    @IsNotEmpty()
    @IsUUID()
    eventId: string;

    @IsNotEmpty()
    @IsUUID()
    tenantId: string;

    @IsNotEmpty()
    @IsString()
    eventType: string;

    @IsNotEmpty()
    @IsObject()
    data: Record<string, any>;

    @IsNotEmpty()
    @IsDateString()
    timestamp: string;

    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

export class SnsPublishOptionsDto {
    @IsNotEmpty()
    @IsString()
    topic: string;

    @IsNotEmpty()
    @IsString()
    groupId: string;

    @IsNotEmpty()
    @IsString()
    deduplicationId: string;
}
