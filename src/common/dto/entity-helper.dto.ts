import { ApiProperty } from '@nestjs/swagger';

export class EntityHelperDto {
    @ApiProperty({ type: String, format: 'date-time' })
    createdAt: Date;

    @ApiProperty({ type: String, format: 'date-time' })
    updatedAt: Date;

    @ApiProperty({ type: String, format: 'date-time' })
    deletedAt: Date;
}
