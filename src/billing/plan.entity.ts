import EntityHelper from '@mod/common/entities/entity-helper';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { PlanLimits } from './plan-limits.type';

@Entity({ name: 'plans' })
export class PlanEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar' })
    name: string;

    @Column({ name: 'stripe_price_id', type: 'varchar', nullable: true })
    stripePriceId?: string | null;

    @Column({ name: 'stripe_product_id', type: 'varchar', nullable: true })
    stripeProductId?: string | null;

    @Column({ type: 'varchar', nullable: true })
    interval?: string | null;

    @Column({ type: 'jsonb', nullable: true })
    limits?: PlanLimits | null;

    @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
    tenantId?: string | null;

    @ManyToOne(() => TenantEntity, {
        onDelete: 'CASCADE',
        nullable: true
    })
    @JoinColumn({ name: 'tenant_id' })
    tenant?: TenantEntity | null;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    @Column({ name: 'manual_invoicing', type: 'boolean', default: false })
    manualInvoicing: boolean;

    @Column({ type: 'jsonb', nullable: true })
    metadata?: Record<string, any> | null;
}
