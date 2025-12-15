import EntityHelper from '@mod/common/entities/entity-helper';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity({ name: 'api_keys' })
@Index(['tenantId', 'status'])
@Index(['keyPrefix'])
export class ApiKeyEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    tenantId: string;

    @Column()
    name: string;

    @Column()
    keyHash: string;

    @Column({ length: 20 })
    keyPrefix: string;

    @Column({
        type: 'enum',
        enum: ApiKeyStatusEnum,
        default: ApiKeyStatusEnum.ACTIVE
    })
    status: ApiKeyStatusEnum;

    @Column({ type: 'jsonb', default: [] })
    scopes: string[];

    @Column()
    createdBy: string;

    @Column({ type: 'timestamp', nullable: true })
    lastUsedAt: Date | null;

    @Column({ type: 'timestamp', nullable: false })
    expiresAt: Date;
}
