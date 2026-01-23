import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UploadedFile,
    UseInterceptors,
    StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Paginate, PaginateQuery, Paginated } from 'nestjs-paginate';
import { TotoService } from './toto.service';
import { CreateTotoDto, UpdateTotoDto, TotoResponse } from '@app/domains/toto';
import { MulterFile } from '@app/types';
import { Idempotent, IdempotencyScope } from '@app/common/idempotency';
import { AppLoggerService } from '@app/common/logging/app-logger.service';

@Controller('api/v1/totos')
export class TotoController {
    constructor(
        private readonly totoService: TotoService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(TotoController.name);
    }

    /**
     * Create a new toto
     * POST /api/v1/totos
     *
     * Idempotency: Uses tenant-scoped idempotency key from header
     * Send "Idempotency-Key" header to prevent duplicate creates
     */
    @Post()
    @Idempotent({
        scope: IdempotencyScope.Tenant,
        ttl: 3600, // 1 hour
        storeResponse: true,
    })
    async create(@Body() dto: CreateTotoDto): Promise<TotoResponse> {
        this.logger.log(`Creating toto: ${dto.name}`);
        const result = await this.totoService.create(dto);
        this.logger.log(`Toto created successfully: ${result.id}`);
        return result;
    }

    /**
     * Get toto by ID
     * GET /api/v1/totos/:id
     */
    @Get(':id')
    async findById(@Param('id') id: string): Promise<TotoResponse> {
        return this.totoService.findById(id);
    }

    /**
     * List totos with pagination, filtering, sorting, and search
     *
     * Examples:
     * - Pagination: GET /api/v1/totos?page=1&limit=10
     * - Sorting: GET /api/v1/totos?sortBy=name:ASC&sortBy=createdAt:DESC
     * - Filtering: GET /api/v1/totos?filter.status=active
     * - Search: GET /api/v1/totos?search=keyword
     * - Combined: GET /api/v1/totos?page=2&limit=20&sortBy=name:ASC&filter.status=active&search=test
     *
     * Returns:
     * {
     *   data: TotoResponse[],
     *   meta: {
     *     itemsPerPage: 10,
     *     totalItems: 100,
     *     currentPage: 1,
     *     totalPages: 10,
     *     sortBy: [["createdAt", "DESC"]],
     *     searchBy: ["name", "description"],
     *     filter: { status: "active" }
     *   },
     *   links: {
     *     first: "http://localhost:3000/api/v1/totos?page=1&limit=10",
     *     previous: "http://localhost:3000/api/v1/totos?page=1&limit=10",
     *     current: "http://localhost:3000/api/v1/totos?page=2&limit=10",
     *     next: "http://localhost:3000/api/v1/totos?page=3&limit=10",
     *     last: "http://localhost:3000/api/v1/totos?page=10&limit=10"
     *   }
     * }
     */
    @Get()
    async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<TotoResponse>> {
        return this.totoService.findAll(query);
    }

    /**
     * Update toto
     * PUT /api/v1/totos/:id
     *
     * Idempotency: Uses tenant-scoped idempotency key from header
     * Send "Idempotency-Key" header to prevent duplicate updates
     */
    @Put(':id')
    @Idempotent({
        scope: IdempotencyScope.Tenant,
        ttl: 1800, // 30 minutes
        storeResponse: true,
    })
    async update(@Param('id') id: string, @Body() dto: UpdateTotoDto): Promise<TotoResponse> {
        this.logger.log(`Updating toto: ${id}`);
        const result = await this.totoService.update(id, dto);
        this.logger.log(`Toto updated successfully: ${id}`);
        return result;
    }

    /**
     * Delete toto
     * DELETE /api/v1/totos/:id
     */
    @Delete(':id')
    async delete(@Param('id') id: string): Promise<{ message: string }> {
        await this.totoService.delete(id);
        return { message: 'Toto deleted successfully' };
    }

    /**
     * Upload file for toto
     * POST /api/v1/totos/:id/upload
     *
     * Idempotency: Uses tenant-scoped idempotency key from header
     * Send "Idempotency-Key" header to prevent duplicate uploads
     */
    @Post(':id/upload')
    @UseInterceptors(FileInterceptor('file'))
    @Idempotent({
        scope: IdempotencyScope.Tenant,
        ttl: 3600, // 1 hour
        storeResponse: true,
    })
    async uploadFile(
        @Param('id') id: string,
        @UploadedFile() file: MulterFile,
    ): Promise<TotoResponse> {
        this.logger.log(`Uploading file for toto: ${id}, filename: ${file.originalname}`);
        const result = await this.totoService.uploadFile(id, file.buffer, file.originalname);
        this.logger.log(`File uploaded successfully for toto: ${id}`);
        return result;
    }

    /**
     * Download file for toto
     * GET /api/v1/totos/:id/download
     */
    @Get(':id/download')
    async downloadFile(@Param('id') id: string): Promise<StreamableFile> {
        const buffer = await this.totoService.downloadFile(id);
        return new StreamableFile(buffer);
    }

    /**
     * Fetch external data
     * GET /api/v1/totos/:id/external-data
     */
    @Get(':id/external-data')
    async fetchExternalData(@Param('id') id: string): Promise<any> {
        return this.totoService.fetchExternalData(id);
    }
}
