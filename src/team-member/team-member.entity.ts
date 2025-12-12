import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '../tenant/tenant.entity';
import { RoleEnum } from '@mod/common/enums/role.enum';
import EntityHelper from '@mod/common/entities/entity-helper';

@Entity('team_members')
export class TeamMemberEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string;

    @Column({
        type: 'enum',
        enum: RoleEnum,
        default: RoleEnum.MEMBER
    })
    role: RoleEnum;

    @ManyToOne('TenantEntity', 'members', { onDelete: 'CASCADE' })
    tenant: TenantEntity;
}
