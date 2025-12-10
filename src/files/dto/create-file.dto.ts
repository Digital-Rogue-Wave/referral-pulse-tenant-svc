import { AutoMap } from '@automapper/classes';
import { Validate } from 'class-validator';
import { IsExist } from '../../utils/validators/is-exists.validator';

export class CreateFileDto {
    @AutoMap()
    @Validate(IsExist, ['FileEntity', 'id', 'validation.imageNotExists'])
    id: string;

    @AutoMap()
    path: string;

    constructor({ id, path }: { id: string; path: string }) {
        this.id = id;
        this.path = path;
    }
}
