import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';

export class UpdateApiKeyStatusDto {
    @ApiProperty({
        description: 'New status for the API key',
        enum: ApiKeyStatusEnum,
        example: ApiKeyStatusEnum.STOPPED
    })
    @IsEnum(ApiKeyStatusEnum)
    status: ApiKeyStatusEnum;
}
