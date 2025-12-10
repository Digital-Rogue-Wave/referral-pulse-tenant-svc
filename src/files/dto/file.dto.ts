import { AutoMap } from '@automapper/classes';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { ApiProperty } from '@nestjs/swagger';

export class FileDto extends EntityHelperDto {
    @ApiProperty()
    @AutoMap()
    id: string;

    @ApiProperty()
    @AutoMap()
    path: string;

    @ApiProperty()
    @AutoMap()
    mimeType: string;
}
