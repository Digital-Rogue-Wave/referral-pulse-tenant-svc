import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';

export class EntityHelperDto {
    @ApiProperty({ type: String, format: 'date-time' })
    @Expose()
    createdAt!: Date;

    @ApiProperty({ type: String, format: 'date-time' })
    @Expose()
    updatedAt!: Date;

    @ApiProperty({ type: String, format: 'date-time', nullable: true })
    @Expose()
    deletedAt?: Date;
}
