import { ApiProperty } from '@nestjs/swagger';

export class FileDto {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    path!: string;

    @ApiProperty()
    mimeType!: string;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    deletedAt?: Date | null;
}

export class PresignedUrlResponseDto {
    @ApiProperty()
    presignedUrl!: string;

    @ApiProperty()
    fileName!: string;

    constructor(data: { presignedUrl: string; fileName: string }) {
        this.presignedUrl = data.presignedUrl;
        this.fileName = data.fileName;
    }
}
