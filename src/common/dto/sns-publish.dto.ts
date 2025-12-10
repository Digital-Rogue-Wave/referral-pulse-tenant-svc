import { IsNotEmpty, IsString, IsUUID, IsObject, IsDateString } from 'class-validator';

export class PublishSnsEventDto {
    @IsNotEmpty()
    @IsUUID()
    eventId: string;

    @IsNotEmpty()
    @IsString()
    eventType: string;

    @IsNotEmpty()
    @IsObject()
    data: Record<string, any>;

    @IsNotEmpty()
    @IsDateString()
    timestamp: string;
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
