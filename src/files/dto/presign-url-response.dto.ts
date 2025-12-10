import { IsNotEmpty, IsString } from 'class-validator';
import { AutoMap } from '@automapper/classes';

export class PresignedUrlResponseDto {
    @AutoMap()
    @IsString()
    @IsNotEmpty()
    presignedUrl: string;

    @AutoMap()
    @IsString()
    @IsNotEmpty()
    fileName: string;
    constructor({ presignedUrl, fileName }: { presignedUrl: string; fileName: string }) {
        this.presignedUrl = presignedUrl;
        this.fileName = fileName;
    }
}
