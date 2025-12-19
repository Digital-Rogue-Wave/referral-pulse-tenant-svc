import EntityHelper from '@mod/common/entities/entity-helper';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/billing.enum';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

@Entity({ name: 'billings' })
@Index(['tenantId'], { unique: true })
export class BillingEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'tenant_id' })
    tenantId: string;

    @ManyToOne(() => TenantEntity, {
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'tenant_id' })
    tenant: TenantEntity;

    @Column({
        type: 'enum',
        enum: BillingPlanEnum,
        enumName: 'billing_plan_enum',
        default: BillingPlanEnum.FREE
    })
    plan: BillingPlanEnum;

    @Column({
        type: 'enum',
        enum: SubscriptionStatusEnum,
        enumName: 'subscription_status_enum',
        default: SubscriptionStatusEnum.NONE
    })
    status: SubscriptionStatusEnum;

    @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
    stripeCustomerId?: string | null;

    @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
    stripeSubscriptionId?: string | null;

    @Column({ name: 'stripe_transaction_id', type: 'varchar', nullable: true })
    stripeTransactionId?: string | null;
}
