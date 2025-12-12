import EntityHelper from '@mod/common/entities/entity-helper';
import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity({ name: 'feature_flags' })
export class FeatureFlagEntity extends EntityHelper {
    @PrimaryColumn()
    key: string;

    @Column()
    description: string;

    @Column({ name: 'default_value', default: false })
    defaultValue: boolean;

    @Column({ type: 'jsonb', name: 'overrides', default: {} })
    overrides: Record<string, boolean>;
}
