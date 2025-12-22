import EntityHelper from '@mod/common/entities/entity-helper';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'billing_events' })
@Index(['tenantId', 'timestamp'])
export class BillingEventEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'tenant_id', type: 'uuid' })
    tenantId: string;

    @ManyToOne(() => TenantEntity, {
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'tenant_id' })
    tenant: TenantEntity;

    @Column({ name: 'event_type', type: 'varchar' })
    eventType: string;

    @Column({ name: 'metric_name', type: 'varchar', nullable: true })
    metricName?: string | null;

    @Column({ name: 'increment', type: 'integer', nullable: true })
    increment?: number | null;

    @Column({ name: 'timestamp', type: 'timestamp' })
    timestamp: Date;

    @Column({ type: 'jsonb', nullable: true })
    metadata?: Record<string, any> | null;
}
