import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@app/domains/common/base.entity';

@Entity('totos')
@Index(['tenantId', 'status'])
export class TotoEntity extends BaseEntity {
    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'varchar', length: 50, default: 'active' })
    status: 'active' | 'inactive' | 'archived';

    @Column({ type: 'int', default: 0 })
    processCount: number;

    @Column({ name: 'file_url', type: 'varchar', length: 500, nullable: true })
    fileUrl?: string;

    @Column({ name: 'external_data', type: 'jsonb', nullable: true })
    externalData?: Record<string, any>;

    incrementProcessCount(): void {
        this.processCount++;
    }
}