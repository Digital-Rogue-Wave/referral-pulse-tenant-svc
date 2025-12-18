import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity({ name: 'reserved_subdomains' })
export class ReservedSubdomainEntity {
    @PrimaryColumn()
    slug: string;

    @Column({ type: 'timestamp' })
    expiresAt: Date;

    @Column({ nullable: true })
    originalTenantId?: string;
}
