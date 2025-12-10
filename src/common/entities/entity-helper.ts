import { BaseEntity, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export default class EntityHelper extends BaseEntity {
    @ApiProperty({ type: String, format: 'date-time' })
    @CreateDateColumn({
        name: 'created_at',
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP'
    })
    createdAt: Date;

    @ApiProperty({ type: String, format: 'date-time' })
    @UpdateDateColumn({
        name: 'updated_at',
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP'
    })
    updatedAt: Date;

    @ApiProperty({ type: String, format: 'date-time' })
    @DeleteDateColumn({
        name: 'deleted_at',
        type: 'timestamp',
        nullable: true
    })
    deletedAt: Date;
}
