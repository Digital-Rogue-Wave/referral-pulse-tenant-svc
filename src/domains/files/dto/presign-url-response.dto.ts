import { IsNotEmpty, IsString } from 'class-validator';

export class PresignedUrlResponseDto {
    @IsString()
    @IsNotEmpty()
    presignedUrl: string;

    @IsString()
    @IsNotEmpty()
    fileName: string;

    constructor({ presignedUrl, fileName }: { presignedUrl: string; fileName: string }) {
        this.presignedUrl = presignedUrl;
        this.fileName = fileName;
    }
}
