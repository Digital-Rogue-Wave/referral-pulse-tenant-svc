import { EntityHelperDto } from '@common/models/entity-helper.dto';
import { ApiProperty } from '@nestjs/swagger';

export class FileDto extends EntityHelperDto {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    path!: string;

    @ApiProperty()
    mimeType!: string;
}
