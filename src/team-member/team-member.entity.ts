import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '../tenant/tenant.entity';
import { RoleEnum } from '@mod/common/enums/role.enum';
import { TeamMemberStatusEnum } from '@mod/common/enums/team-member-status.enum';
import EntityHelper from '@mod/common/entities/entity-helper';
import { AutoMap } from '@automapper/classes';

@Entity('team_members')
export class TeamMemberEntity extends EntityHelper {
    @AutoMap()
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @AutoMap()
    @Column()
    userId: string;

    @AutoMap()
    @Column()
    tenantId: string;

    @AutoMap()
    @Column({
        type: 'enum',
        enum: RoleEnum,
        default: RoleEnum.MEMBER
    })
    role: RoleEnum;

    @AutoMap()
    @Column({
        type: 'enum',
        enum: TeamMemberStatusEnum,
        default: TeamMemberStatusEnum.ACTIVE
    })
    status: TeamMemberStatusEnum;

    @AutoMap(() => TenantEntity)
    @ManyToOne('TenantEntity', 'members', { onDelete: 'CASCADE' })
    tenant: TenantEntity;
}
