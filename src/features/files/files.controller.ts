import {
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Put,
    UploadedFile,
    UploadedFiles,
    UseInterceptors,
    BadRequestException,
    UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Idempotent, IdempotencyScope } from '@common/idempotency';
import type { File } from '@prisma-gen/generated/client';
import type { NullableType } from '@app/types';
import { FileDto, PresignedUrlResponseDto } from '@domains/files';

import { FilesService } from './files.service';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { PaymentRequiredGuard } from '@app/features/billing/guards/payment-required.guard';

/** Accepted upload types (logos/branding + documents) and size cap. */
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const FILE_UPLOAD_OPTIONS: MulterOptions = {
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
            return;
        }
        cb(null, true);
    }
};

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(PaymentRequiredGuard)
@Controller({
    path: 'files',
    version: '1'
})
export class FilesController {
    constructor(private readonly filesService: FilesService) {}

    @Post('upload')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary'
                }
            }
        }
    })
    @ApiOkResponse({ type: FileDto })
    @UseInterceptors(FileInterceptor('file', FILE_UPLOAD_OPTIONS))
    @HttpCode(HttpStatus.CREATED)
    async uploadFile(@UploadedFile() file: Express.Multer.File | Express.MulterS3.File): Promise<File> {
        return this.filesService.uploadFile(file);
    }

    @Post('upload-multiple')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                files: {
                    type: 'array',
                    items: {
                        type: 'string',
                        format: 'binary'
                    }
                }
            }
        }
    })
    @ApiOkResponse({ type: FileDto, isArray: true })
    @UseInterceptors(FilesInterceptor('files', 10, FILE_UPLOAD_OPTIONS))
    @HttpCode(HttpStatus.CREATED)
    async uploadMultipleFiles(@UploadedFiles() files: Array<Express.Multer.File | Express.MulterS3.File>): Promise<File[]> {
        return this.filesService.uploadMultipleFiles(files);
    }

    @Get('presigned/:type')
    @ApiBearerAuth()
    @ApiOkResponse({ type: PresignedUrlResponseDto })
    async getPresignedUrl(@Param('type') type: string): Promise<PresignedUrlResponseDto> {
        return this.filesService.getPresignedUrl(type);
    }

    @Get(':id')
    @ApiOkResponse({ type: FileDto })
    @HttpCode(HttpStatus.OK)
    async findOne(@Param('id') id: string): Promise<NullableType<File>> {
        return this.filesService.findOneForTenant(id);
    }

    /**
     * Update a file in storage and database
     * @returns {Promise<File>} updated file
     * @param id
     * @param file {Express.Multer.File | Express.MulterS3.File} file to update
     */
    @Put(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary'
                }
            }
        }
    })
    @ApiOkResponse({ type: FileDto })
    @UseInterceptors(FileInterceptor('file', FILE_UPLOAD_OPTIONS))
    @HttpCode(HttpStatus.OK)
    async updateFile(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | Express.MulterS3.File): Promise<File> {
        return this.filesService.updateFile(id, file);
    }

    /**
     * Delete a file in storage and database
     * @returns {Promise<File>} deleted file
     * @param id file id
     */
    @Delete(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    @ApiOkResponse({ type: FileDto })
    @HttpCode(HttpStatus.OK)
    async deleteFile(@Param('id') id: string): Promise<File> {
        return this.filesService.deleteFile(id);
    }
}
