import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

export enum TenantStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    PENDING = 'pending'
}

@Entity('tenants')
export class TenantEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column()
    name!: string;

    @Column({ unique: true })
    slug!: string;

    @Column({
        type: 'enum',
        enum: TenantStatus,
        default: TenantStatus.ACTIVE
    })
    status!: TenantStatus;

    @Column({ type: 'jsonb', default: {} })
    settings!: Record<string, any>;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;

    @DeleteDateColumn()
    deletedAt!: Date;
}
