import EntityHelper from '@mod/common/entities/entity-helper';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { FileEntity } from '@mod/files/file.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'tenants' })
export class TenantEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ unique: true })
    slug: string;

    @ManyToOne(() => FileEntity, {
        eager: true
    })
    image?: FileEntity | null;

    @Column({
        type: 'enum',
        enum: TenantStatusEnum,
        default: TenantStatusEnum.ACTIVE
    })
    status: TenantStatusEnum;

    @Column({ type: 'jsonb', default: {} })
    settings: Record<string, any>;
}
