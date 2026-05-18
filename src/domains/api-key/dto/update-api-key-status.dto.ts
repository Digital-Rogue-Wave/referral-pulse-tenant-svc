import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { ApiKeyStatus } from '../index';

export class UpdateApiKeyStatusDto {
    @ApiProperty({ enum: ApiKeyStatus })
    @IsEnum(ApiKeyStatus)
    status!: string;
}
