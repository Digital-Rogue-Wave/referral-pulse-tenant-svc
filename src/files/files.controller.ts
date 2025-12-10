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
    UseGuards,
    UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesService } from './files.service';
import { DeleteResult } from 'typeorm';
import { FileEntity } from './file.entity';
import { InjectMapper, MapInterceptor } from '@automapper/nestjs';
import { FileDto } from './dto/file.dto';
import { PresignedUrlResponseDto } from './dto/presign-url-response.dto';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiPaginationQuery, Paginate, PaginateQuery } from 'nestjs-paginate';
import { filePaginationConfig } from './config/files-pagination.config';
import { PaginatedDto } from '../common/serialization/paginated.dto';
import { Mapper } from '@automapper/core';
import { NullableType } from '@mod/types/nullable.type';

@ApiTags('Files')
@ApiBearerAuth()
@Controller({
    path: 'files',
    version: '1'
})
export class FilesController {
    constructor(
        private readonly filesService: FilesService,
        @InjectMapper() private readonly mapper: Mapper
    ) {}

    @ApiBearerAuth()
    @Post('upload')
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
    @UseInterceptors(FileInterceptor('file'))
    @UseInterceptors(MapInterceptor(FileEntity, FileDto))
    @HttpCode(HttpStatus.CREATED)
    async uploadFile(@UploadedFile() file: Express.Multer.File | Express.MulterS3.File) {
        return this.filesService.uploadFile(file);
    }

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
    @UseInterceptors(FilesInterceptor('files', 10))
    @UseInterceptors(MapInterceptor(FileEntity, FileDto, { isArray: true }))
    @HttpCode(HttpStatus.CREATED)
    @Post('upload-multiple')
    async uploadMultipleFiles(@UploadedFiles() files: Array<Express.Multer.File | Express.MulterS3.File>): Promise<FileEntity[]> {
        return this.filesService.uploadMultipleFiles(files);
    }

    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'))
    @Get('presigned/:type')
    async getPresignedUrl(@Param('type') type: string): Promise<PresignedUrlResponseDto> {
        return await this.filesService.getPresignedUrl(type);
    }

    @ApiPaginationQuery(filePaginationConfig)
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAllPaginated(@Paginate() query: PaginateQuery): Promise<PaginatedDto<FileEntity, FileDto>> {
        const files = await this.filesService.findAllPaginated(query);
        return new PaginatedDto<FileEntity, FileDto>(this.mapper, files, FileEntity, FileDto);
    }
    @UseInterceptors(MapInterceptor(FileEntity, FileDto))
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<NullableType<FileEntity>> {
        return this.filesService.findOne({ id });
    }

    /**
     * Update a file in storage and database
     * @returns {Promise<FileEntity>} updated file
     * @param id
     * @param file {Express.Multer.File | Express.MulterS3.File} file to update
     */
    @ApiOperation({
        summary: 'Update a file in storage and database',
        description: 'This endpoint update a file in storage and database.'
    })
    @Put(':id')
    @HttpCode(HttpStatus.OK)
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
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(FileInterceptor('file'))
    @HttpCode(HttpStatus.OK)
    async updateFile(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | Express.MulterS3.File): Promise<FileEntity> {
        return this.filesService.updateFile(id, file);
    }

    /**
     * Delete a file in storage and database
     * @returns {Promise<DeleteResult>} updated file
     * @param id file id
     */
    @ApiOperation({
        summary: 'Delete a file in storage and database',
        description: 'This endpoint delete a file from storage and database.'
    })
    @UseGuards(AuthGuard('jwt'))
    @HttpCode(HttpStatus.OK)
    @Delete(':id')
    async deleteFile(@Param('id') id: string): Promise<DeleteResult> {
        return await this.filesService.deleteFile(id);
    }
}
