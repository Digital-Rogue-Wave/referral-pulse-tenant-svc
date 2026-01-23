import {
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    BeforeInsert,
    Index,
} from 'typeorm';
import { ulid } from 'ulid';

export abstract class BaseEntity {
    @PrimaryColumn('varchar', { length: 26 })
    id: string;

    @Index()
    @Column('varchar', { length: 26 })
    tenantId: string;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;

    @DeleteDateColumn({ type: 'timestamptz', nullable: true })
    deletedAt?: Date;

    @BeforeInsert()
    generateId(): void {
        if (!this.id) {
            this.id = ulid();
        }
    }
}
