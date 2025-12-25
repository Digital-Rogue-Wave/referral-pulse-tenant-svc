import { AutoMap } from '@automapper/classes';
import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity({ name: 'reserved_subdomains' })
export class ReservedSubdomainEntity {
    @AutoMap()
    @PrimaryColumn()
    slug: string;

    @AutoMap()
    @Column({ type: 'timestamp' })
    expiresAt: Date;

    @AutoMap()
    @Column({ nullable: true })
    originalTenantId?: string;
}
