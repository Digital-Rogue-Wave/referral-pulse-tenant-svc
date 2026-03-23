import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { File, Prisma } from '@prisma-gen/generated/client';
import type { AllConfigType } from '@config/config.type';
import type { NullableType } from '@app/types';

import { DatabaseService } from '@app/database/database.service';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { S3Service } from '@common/storage/s3.service';
import { PresignedUrlResponseDto, FileDto } from '@domains/files';

@Injectable()
export class FilesService {
    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly prisma: DatabaseService,
        private readonly awsS3Service: S3Service,
        private readonly i18n: I18nService,
    ) {}

    async findOne(where: Prisma.FileWhereInput): Promise<NullableType<File>> {
        return this.prisma.file.findFirst({
            where: { ...where, deletedAt: null },
        });
    }

    async findOneOrFail(where: Prisma.FileWhereInput): Promise<File> {
        const file = await this.prisma.file.findFirst({
            where: { ...where, deletedAt: null },
        });
        if (!file) {
            throw new HttpException(
                {
                    status: HttpStatus.NOT_FOUND,
                    message: 'File not found',
                },
                HttpStatus.NOT_FOUND,
            );
        }
        return file;
    }

    async uploadFile(file: Express.Multer.File | Express.MulterS3.File): Promise<File> {
        if (!file) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.failedUpload', {
                            lang: I18nContext.current()?.lang,
                        }),
                    },
                },
                HttpStatus.PRECONDITION_FAILED,
            );
        }
        return this.prisma.file.create({
            data: {
                mimeType: file.mimetype,
                path: (file as Express.MulterS3.File).location,
            },
        });
    }

    async uploadMultipleFiles(files: Array<Express.Multer.File | Express.MulterS3.File>): Promise<File[]> {
        if (!files) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.failedUpload', {
                            lang: I18nContext.current()?.lang,
                        }),
                    },
                },
                HttpStatus.PRECONDITION_FAILED,
            );
        }
        return this.handleMultipleFilesUpload(files);
    }

    /**
     * Update file in storage and database
     * @returns {Promise<File>} success update of the file
     * @param id
     * @param file
     */
    async updateFile(id: string, file: Express.Multer.File | Express.MulterS3.File): Promise<File> {
        if (!file) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.failedUpload', {
                            lang: I18nContext.current()?.lang,
                        }),
                    },
                },
                HttpStatus.PRECONDITION_FAILED,
            );
        }
        // Delete old file from S3
        const fileToUpdate = await this.findOneOrFail({ id });
        const fileKey = this.extractKeyFromUrl(fileToUpdate.path);
        await this.awsS3Service.delete(fileKey);

        return this.prisma.file.update({
            where: { id },
            data: {
                mimeType: file.mimetype,
                path: (file as Express.MulterS3.File).location,
            },
        });
    }

    async deleteMultipleFiles(files: FileDto[]): Promise<void> {
        for (const file of files) {
            await this.deleteFile(file.id);
        }
    }

    /**
     * Delete file from storage and database
     * @returns {Promise<File>} deleted file
     * @param id
     */
    async deleteFile(id: string): Promise<File> {
        const fileToDelete = await this.findOneOrFail({ id });
        const fileKey = this.extractKeyFromUrl(fileToDelete.path);

        // Delete from S3
        await this.awsS3Service.delete(fileKey);

        // Soft delete from database
        return this.prisma.file.update({
            where: { id: fileToDelete.id },
            data: { deletedAt: new Date() },
        });
    }

    /**
     * Extract the file key using its url
     * @returns {string} file key
     * @param url
     */
    extractKeyFromUrl(url: string): string {
        const urlParts = url.split('/');
        const key = urlParts[urlParts.length - 1];
        if (!key) {
            throw new HttpException(
                { status: HttpStatus.BAD_REQUEST, message: 'Invalid file URL' },
                HttpStatus.BAD_REQUEST,
            );
        }
        return key;
    }

    async createFileFromUrl(url: string): Promise<File> {
        const existingFile = await this.findOne({ path: url });
        if (existingFile) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.fileExists', {
                            lang: I18nContext.current()?.lang,
                        }),
                    },
                },
                HttpStatus.PRECONDITION_FAILED,
            );
        }
        return this.prisma.file.create({
            data: { path: url, mimeType: 'application/octet-stream' },
        });
    }

    async getPresignedUrl(type: string): Promise<PresignedUrlResponseDto> {
        const fileName = `${randomUUID()}.${type}`;
        const presignedUrl = await this.awsS3Service.getPresignedUploadUrl(fileName, {
            contentType: 'application/octet-stream',
        });
        return new PresignedUrlResponseDto({ presignedUrl, fileName });
    }

    private async handleMultipleFilesUpload(
        files: Array<Express.Multer.File | Express.MulterS3.File>,
    ): Promise<File[]> {
        return this.prisma.$transaction(async (tx) => {
            return Promise.all(
                files.map(async (file) => {
                    return tx.file.create({
                        data: {
                            mimeType: file.mimetype,
                            path: (file as Express.MulterS3.File).location,
                        },
                    });
                }),
            );
        });
    }
}
