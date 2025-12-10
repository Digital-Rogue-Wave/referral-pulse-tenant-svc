import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from './file.entity';
import { DataSource, DeleteResult, FindOptionsWhere, Repository } from 'typeorm';
import { AllConfigType } from '../config/config.type';

import { I18nContext, I18nService } from 'nestjs-i18n';
import { PresignedUrlResponseDto } from './dto/presign-url-response.dto';
import { FileDto } from './dto/file.dto';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { filePaginationConfig } from './config/files-pagination.config';
import { S3Service } from '@mod/common/aws-s3/s3.service';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class FilesService {
    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        @InjectRepository(FileEntity)
        private readonly fileRepository: Repository<FileEntity>,
        private readonly awsS3Service: S3Service,
        private readonly i18n: I18nService,
        private dataSource: DataSource
    ) {}

    async findAllPaginated(query: PaginateQuery): Promise<Paginated<FileEntity>> {
        return await paginate<FileEntity>(query, this.fileRepository, filePaginationConfig);
    }

    async findOne(fields: FindOptionsWhere<FileEntity>): Promise<NullableType<FileEntity>> {
        return await this.fileRepository.findOne({
            where: fields
        });
    }

    async findOneOrFail(fields: FindOptionsWhere<FileEntity>): Promise<FileEntity> {
        return await this.fileRepository.findOneOrFail({
            where: fields
        });
    }

    async uploadFile(file: Express.Multer.File | Express.MulterS3.File): Promise<FileEntity> {
        if (!file) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.failedUpload', {
                            lang: I18nContext.current()?.lang
                        })
                    }
                },
                HttpStatus.PRECONDITION_FAILED
            );
        }
        return this.fileRepository.save(
            this.fileRepository.create({
                mimeType: file.mimetype,
                path: (file as Express.MulterS3.File).location
            })
        );
    }

    async uploadMultipleFiles(files: Array<Express.Multer.File | Express.MulterS3.File>): Promise<FileEntity[]> {
        if (!files) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.failedUpload', {
                            lang: I18nContext.current()?.lang
                        })
                    }
                },
                HttpStatus.PRECONDITION_FAILED
            );
        }
        return await this.handleMultipleFilesUpload(files);
    }

    /**
     * Update file in storage and database
     * @returns {Promise<FileEntity>} success update of the file
     * @param id
     * @param file
     */
    async updateFile(id: string, file: Express.Multer.File | Express.MulterS3.File): Promise<FileEntity> {
        if (!file) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.failedUpload', {
                            lang: I18nContext.current()?.lang
                        })
                    }
                },
                HttpStatus.PRECONDITION_FAILED
            );
        }
        // Delete old file
        const fileToUpdate = await this.findOneOrFail({ id });
        const fileKey = this.extractKeyFromUrl(fileToUpdate.path);
        await this.awsS3Service.deleteObject(fileKey);

        const updatedFile = Object.assign({}, fileToUpdate, {
            mimeType: file.mimetype,
            path: (file as Express.MulterS3.File).location
        });
        return this.fileRepository.save(updatedFile);
    }

    async deleteMultipleFiles(files: FileDto[]) {
        for (const file of files) {
            await this.deleteFile(file.id);
        }
    }

    /**
     * Delete file from storage and database
     * @returns {Promise<DeleteResult>} success deletion of the file
     * @param id
     */
    async deleteFile(id: string): Promise<DeleteResult> {
        const fileToDelete = await this.findOneOrFail({ id });
        const fileKey = this.extractKeyFromUrl(fileToDelete.path);

        // Call the appropriate delete handler
        await this.awsS3Service.deleteObject(fileKey);

        // Delete the record from the database
        return this.fileRepository.delete(fileToDelete.id);
    }

    /**
     * Extract the file key using its url
     * @returns {string} file key
     * @param url
     */
    extractKeyFromUrl(url: string): string {
        const urlParts = url.split('/');
        return urlParts[urlParts.length - 1];
    }

    async createFileFromUrl(url: string): Promise<FileEntity> {
        const existingFile = await this.findOne({ path: url });
        if (!!existingFile) {
            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        file: this.i18n.t('file.fileExists', {
                            lang: I18nContext.current()?.lang
                        })
                    }
                },
                HttpStatus.PRECONDITION_FAILED
            );
        }
        const file = this.fileRepository.create({ path: url });
        return await this.fileRepository.save(file);
    }

    async getPresignedUrl(type: string): Promise<PresignedUrlResponseDto> {
        const fileName = `${randomUUID()}.${type}`;
        const presignedUrl = await this.awsS3Service.presignPut({
            key: fileName,
            contentType: 'application/octet-stream'
        });
        return new PresignedUrlResponseDto({ presignedUrl, fileName });
    }

    private async handleMultipleFilesUpload(files: Array<Express.Multer.File | Express.MulterS3.File>): Promise<FileEntity[]> {
        return await this.dataSource.transaction(async (manager) => {
            return await Promise.all(
                files.map(async (file) => {
                    return await manager.save(
                        this.fileRepository.create({
                            mimeType: file.mimetype,
                            path: (file as Express.MulterS3.File).location
                        })
                    );
                })
            );
        });
    }
}
