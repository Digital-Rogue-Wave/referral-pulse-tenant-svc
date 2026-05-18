import { IsNotEmpty, IsString } from 'class-validator';

export class CreateFileDto {
    @IsString()
    @IsNotEmpty()
    id: string;

    @IsString()
    @IsNotEmpty()
    path: string;

    constructor({ id, path }: { id: string; path: string }) {
        this.id = id;
        this.path = path;
    }
}
