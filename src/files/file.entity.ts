import { AfterInsert, AfterLoad, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import appConfig, { AppConfig } from '../config/app.config';
import { AutoMap } from '@automapper/classes';
import EntityHelper from '@mod/common/entities/entity-helper';

@Entity({ name: 'files' })
export class FileEntity extends EntityHelper {
    @PrimaryGeneratedColumn('uuid')
    @AutoMap()
    id: string;

    @AutoMap()
    @Column()
    path: string;

    @AutoMap()
    @Column()
    mimeType: string;

    @AfterLoad()
    @AfterInsert()
    updatePath() {
        if (this.path.indexOf('/') === 0) {
            this.path = (appConfig() as AppConfig).backendDomain + this.path;
        }
    }
}
