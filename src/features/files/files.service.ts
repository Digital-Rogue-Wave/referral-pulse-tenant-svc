import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { File, Prisma } from '@prisma-gen/generated/client';
import { I18nContext, I18nService } from 'nestjs-i18n';
import type { NullableType } from '@app/types';
import type { ErrorCode } from '@app/types/app.type';

import { DatabaseService } from '@app/database/database.service';
import { S3Service } from '@common/storage/s3.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { PresignedUrlResponseDto, FileDto } from '@domains/files';

@Injectable()
export class FilesService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly awsS3Service: S3Service,
        private readonly i18n: I18nService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(FilesService.name);
    }

    /** Current tenant id, required — guards the by-id file endpoints against cross-tenant access. */
    private requireTenantId(): string {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) {
            throw new BaseException('tenant_context_required', 'Tenant context is required', HttpStatus.BAD_REQUEST);
        }
        return tenantId;
    }

    /** Look up a file by id scoped to the current tenant (controller-facing). */
    async findOneForTenant(id: string): Promise<NullableType<File>> {
        return this.findOne({ id, tenantId: this.requireTenantId() });
    }

    async findOne(where: Prisma.FileWhereInput): Promise<NullableType<File>> {
        return this.prisma.file.findFirst({
            where: { ...where, deletedAt: null }
        });
    }

    async findOneOrFail(where: Prisma.FileWhereInput): Promise<File> {
        const file = await this.prisma.file.findFirst({
            where: { ...where, deletedAt: null }
        });
        if (!file) {
            throw new BaseException('file_not_found', 'File not found', HttpStatus.NOT_FOUND);
        }
        return file;
    }

    async uploadFile(file: Express.Multer.File | Express.MulterS3.File): Promise<File> {
        if (!file) {
            throw new BaseException(
                'file_upload_failed',
                this.i18n.t('file.failedUpload', { lang: I18nContext.current()?.lang }),
                HttpStatus.PRECONDITION_FAILED
            );
        }
        const key = this.buildFileKey(file);
        const result = await this.awsS3Service.upload(key, (file as Express.Multer.File).buffer, { contentType: file.mimetype });

        return this.prisma.file.create({
            data: {
                tenantId: this.tenantContext.getTenantId() ?? null,
                mimeType: file.mimetype,
                path: result.location
            }
        });
    }

    async uploadMultipleFiles(files: Array<Express.Multer.File | Express.MulterS3.File>): Promise<File[]> {
        if (!files) {
            throw new BaseException(
                'file_upload_failed',
                this.i18n.t('file.failedUpload', { lang: I18nContext.current()?.lang }),
                HttpStatus.PRECONDITION_FAILED
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
            throw new BaseException(
                'file_upload_failed',
                this.i18n.t('file.failedUpload', { lang: I18nContext.current()?.lang }),
                HttpStatus.PRECONDITION_FAILED
            );
        }
        const fileToUpdate = await this.findOneOrFail({ id, tenantId: this.requireTenantId() });

        // Upload the replacement first, then repoint the record, then drop the old object.
        const key = this.buildFileKey(file);
        const result = await this.awsS3Service.upload(key, (file as Express.Multer.File).buffer, { contentType: file.mimetype });

        const updated = await this.prisma.file.update({
            where: { id },
            data: {
                mimeType: file.mimetype,
                path: result.location
            }
        });

        await this.awsS3Service.delete(this.extractKeyFromUrl(fileToUpdate.path));

        return updated;
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
        const fileToDelete = await this.findOneOrFail({ id, tenantId: this.requireTenantId() });
        const fileKey = this.extractKeyFromUrl(fileToDelete.path);

        // Delete from S3
        await this.awsS3Service.delete(fileKey);

        // Soft delete from database
        return this.prisma.file.update({
            where: { id: fileToDelete.id },
            data: { deletedAt: new Date() }
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
            throw new BaseException('invalid_file_url', 'Invalid file URL', HttpStatus.BAD_REQUEST);
        }
        return key;
    }

    async createFileFromUrl(url: string): Promise<File> {
        const existingFile = await this.findOne({ path: url });
        if (existingFile) {
            throw new BaseException(
                'conflict',
                this.i18n.t('file.fileExists', { lang: I18nContext.current()?.lang }),
                HttpStatus.PRECONDITION_FAILED
            );
        }
        return this.prisma.file.create({
            data: { path: url, mimeType: 'application/octet-stream' }
        });
    }

    async getPresignedUrl(type: string): Promise<PresignedUrlResponseDto> {
        const fileName = `${randomUUID()}.${type}`;
        const presignedUrl = await this.awsS3Service.getPresignedUploadUrl(fileName, {
            contentType: 'application/octet-stream'
        });
        return new PresignedUrlResponseDto({ presignedUrl, fileName });
    }

    private async handleMultipleFilesUpload(files: Array<Express.Multer.File | Express.MulterS3.File>): Promise<File[]> {
        const tenantId = this.tenantContext.getTenantId() ?? null;

        // Upload to S3 first (outside the DB transaction), then persist the rows atomically.
        const records = await Promise.all(
            files.map(async (file) => {
                const key = this.buildFileKey(file);
                const result = await this.awsS3Service.upload(key, (file as Express.Multer.File).buffer, { contentType: file.mimetype });
                return { tenantId, mimeType: file.mimetype, path: result.location };
            })
        );

        return this.prisma.$transaction(records.map((data) => this.prisma.file.create({ data })));
    }

    /** Build a unique, tenant-agnostic object key; S3Service prefixes it with `tenants/{tenantId}/`. */
    private buildFileKey(file: Express.Multer.File | Express.MulterS3.File): string {
        const ext = file.mimetype?.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
        return `${randomUUID()}.${ext}`;
    }
}
