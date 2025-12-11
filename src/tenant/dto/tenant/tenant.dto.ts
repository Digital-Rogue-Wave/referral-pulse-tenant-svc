import { ApiProperty } from '@nestjs/swagger';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { FileDto } from '@mod/files/dto/file.dto';

export class TenantDto extends EntityHelperDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;

    @ApiProperty()
    slug: string;

    @ApiProperty({
        type: FileDto,
        required: false
    })
    image?: FileDto | null;

    @ApiProperty({
        enum: TenantStatusEnum,
        enumName: 'TenantStatusEnum',
        description: 'The status of the tenant'
    })
    status: TenantStatusEnum;

    @ApiProperty({ description: 'Custom settings for the tenant' })
    settings: Record<string, any>;
}
