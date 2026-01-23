import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@app/common/tenant/tenant-aware-repository';
import {
    CreateTotoDto,
    UpdateTotoDto,
    TotoResponse,
    totoResponseMapper,
} from '@app/domains/toto';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { HttpClientService } from '@app/common/http/http-client.service';
import { S3Service } from '@app/common/storage/s3.service';
import { RedisService } from '@app/common/redis/redis.service';
import { RedisKeyBuilder } from '@app/common/redis/redis-key.builder';
import { SideEffectService } from '@app/common/side-effects/side-effect.service';
import { TransactionEventEmitterService } from '@app/common/events/transaction-event-emitter.service';
import {
    TotoCreatedEvent,
    TotoUpdatedEvent,
    TotoDeletedEvent,
} from '@app/domains/toto/events/toto.events';
import type { IHttpResponse } from '@app/types';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { Transactional } from 'typeorm-transactional';
import { DataSource } from 'typeorm';
import { TOTO_PAGINATE_CONFIG } from './serializer/toto.paginate-config';
import { TotoEntity } from '@app/toto-exemple/toto.entity';

@Injectable()
export class TotoService {
    constructor(
        @InjectTenantAwareRepository(TotoEntity)
        private readonly totoRepository: TenantAwareRepository<TotoEntity>,
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
        private readonly httpClient: HttpClientService,
        private readonly s3Service: S3Service,
        private readonly redisService: RedisService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
        private readonly sideEffectService: SideEffectService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly dataSource: DataSource,
    ) {
        this.logger.setContext(TotoService.name);
    }

    /**
     * Create a new toto with HYBRID APPROACH:
     * - Database insert
     * - Redis caching (part of business logic)
     * - CRITICAL cross-service: SNS via outbox pattern (guaranteed delivery)
     * - NON-CRITICAL: Event emission for analytics, audit, metrics (fire-and-forget after commit)
     * - HTTP call to external API
     *
     * Demonstrates:
     * - Hybrid architecture: Outbox for critical ops, Events for non-critical
     * - Clean separation: Business logic + one event emission
     * - Listeners handle all side effects (email, analytics, audit, metrics)
     */
    @Transactional()
    async create(dto: CreateTotoDto): Promise<TotoResponse> {
        const tenantId = this.tenantContext.getTenantId();

        this.logger.log(`Creating toto`, {
            tenantId,
            name: dto.name,
            status: dto.status,
        });

        // Create entity
        const toto = this.totoRepository.create({
            ...dto,
            tenantId,
        });

        const saved = await this.totoRepository.save(toto);

        this.logger.log(`Toto entity saved to database`, {
            totoId: saved.id,
            name: saved.name,
        });

        // Cache in Redis (TTL: 1 hour) - part of business logic
        const cacheKey = this.redisKeyBuilder.buildTenantKey('toto', `entity:${saved.id}`);
        await this.redisService.set(cacheKey, saved, { ttl: 3600 });

        this.logger.debug(`Toto cached in Redis`, {
            totoId: saved.id,
            cacheKey,
            ttl: 3600,
        });

        // CRITICAL: SNS notification for cross-service communication (guaranteed delivery via outbox)
        // This uses the outbox pattern for atomicity with DB transaction
        await this.sideEffectService.createSnsSideEffect(
            'toto',
            saved.id,
            'toto.created',
            'toto-events-topic',
            {
                totoId: saved.id,
                name: saved.name,
                tenantId: saved.tenantId,
                status: saved.status,
                createdAt: saved.createdAt,
            },
            { critical: true }, // Outbox pattern - guaranteed delivery
        );

        this.logger.debug(`Critical SNS side effect created in outbox`, {
            totoId: saved.id,
        });

        // NON-CRITICAL: Emit domain event AFTER commit
        // Listeners will handle: analytics, audit trail, metrics
        // Cross-service listener publishes to SNS (Direct SQS + DLQ, not outbox)
        this.txEventEmitter.emitAfterCommit(
            'toto.created',
            new TotoCreatedEvent(
                saved.id,
                saved.tenantId,
                saved.name,
                saved.status,
                this.tenantContext.getUserId(),
            ),
        );

        // Make outbound HTTP call to external API (outside transaction)
        try {
            this.logger.debug(`Calling external API for toto`, {
                totoId: saved.id,
                url: 'https://jsonplaceholder.typicode.com/posts',
            });

            const externalResponse: IHttpResponse<any> = await this.httpClient.post(
                'https://jsonplaceholder.typicode.com/posts',
                {
                    title: saved.name,
                    body: saved.description,
                    userId: 1,
                },
            );

            // Store external data
            saved.externalData = externalResponse.data;
            await this.totoRepository.save(saved);

            this.logger.log(`External API call successful`, {
                totoId: saved.id,
                responseId: externalResponse.data?.id,
            });
        } catch (error) {
            this.logger.error(
                `Failed to call external API: totoId=${saved.id}, error=${(error as Error).message}`,
                (error as Error).stack,
            );
            // Don't throw - external API failure shouldn't fail the whole operation
        }

        this.logger.log(`Toto created successfully`, {
            totoId: saved.id,
            tenantId,
            name: saved.name,
        });

        return totoResponseMapper.toResponse(saved);
    }

    /**
     * Get toto by ID with Redis caching
     * Demonstrates proper use of RedisKeyBuilder for consistent, tenant-scoped cache keys
     */
    async findById(id: string): Promise<TotoResponse> {
        // Use RedisKeyBuilder for consistent, tenant-scoped cache keys
        const cacheKey = this.redisKeyBuilder.buildTenantKey('toto', `entity:${id}`);

        // Try cache first
        const cached = await this.redisService.get<TotoEntity>(cacheKey);
        if (cached) {
            this.logger.debug(`Cache hit for toto: ${id}`);
            return totoResponseMapper.toResponse(cached);
        }

        // Cache miss - query database
        const toto = await this.totoRepository.findOne({ where: { id } });
        if (!toto) {
            throw new NotFoundException(`Toto with ID ${id} not found`);
        }

        // Cache for 1 hour
        await this.redisService.set(cacheKey, toto, { ttl: 3600 });

        return totoResponseMapper.toResponse(toto);
    }

    /**
     * List all totos for current tenant with pagination, filtering, sorting, and search
     * Uses nestjs-paginate for automatic query parameter handling
     *
     * Supports:
     * - Pagination: ?page=1&limit=10
     * - Sorting: ?sortBy=name:ASC&sortBy=createdAt:DESC
     * - Filtering: ?filter.status=active
     * - Search: ?search=keyword
     */
    async findAll(query: PaginateQuery): Promise<Paginated<TotoResponse>> {
        // Use query builder with tenant filtering already applied
        const queryBuilder = this.totoRepository.createQueryBuilder('toto');

        const result = await paginate(query, queryBuilder, TOTO_PAGINATE_CONFIG);

        // Transform entities to response DTOs
        return {
            ...result,
            data: totoResponseMapper.toResponseArray(result.data),
        } as Paginated<TotoResponse>;
    }

    /**
     * Update toto with HYBRID APPROACH:
     * - Database update
     * - Redis cache invalidation (part of business logic)
     * - CRITICAL cross-service: SQS via outbox pattern (guaranteed delivery)
     * - NON-CRITICAL: Event emission for analytics, audit, metrics (fire-and-forget after commit)
     *
     * Demonstrates:
     * - Change tracking for audit
     * - Hybrid architecture: Outbox for critical, Events for non-critical
     * - Clean code: Business logic + one event emission
     */
    @Transactional()
    async update(id: string, dto: UpdateTotoDto): Promise<TotoResponse> {
        const toto = await this.totoRepository.findOne({ where: { id } });
        if (!toto) {
            this.logger.warn(`Toto not found for update`, { totoId: id });
            throw new NotFoundException(`Toto with ID ${id} not found`);
        }

        this.logger.log(`Updating toto`, {
            totoId: id,
            changes: dto,
        });

        // Track changes for audit
        const changes: Record<string, { from: any; to: any }> = {};
        for (const [key, value] of Object.entries(dto)) {
            if ((toto as any)[key] !== value) {
                changes[key] = {
                    from: (toto as any)[key],
                    to: value,
                };
            }
        }

        // Update entity
        Object.assign(toto, dto);
        const updated = await this.totoRepository.save(toto);

        this.logger.log(`Toto updated in database`, {
            totoId: id,
            fieldsChanged: Object.keys(changes),
        });

        // Invalidate cache using RedisKeyBuilder - part of business logic
        const cacheKey = this.redisKeyBuilder.buildTenantKey('toto', `entity:${id}`);
        await this.redisService.del(cacheKey);

        this.logger.debug(`Cache invalidated for toto`, {
            totoId: id,
            cacheKey,
        });

        // CRITICAL: SQS notification for cross-service communication (guaranteed delivery via outbox)
        await this.sideEffectService.createSqsSideEffect(
            'toto',
            updated.id,
            'toto.updated',
            'toto-updates-queue',
            {
                totoId: updated.id,
                name: updated.name,
                status: updated.status,
                tenantId: updated.tenantId,
                updatedAt: updated.updatedAt,
                changes,
            },
        );

        this.logger.debug(`Critical SQS side effect created in outbox`, {
            totoId: id,
        });

        // NON-CRITICAL: Emit domain event AFTER commit
        // Listeners will handle: analytics, audit trail, metrics
        this.txEventEmitter.emitAfterCommit(
            'toto.updated',
            new TotoUpdatedEvent(
                updated.id,
                updated.tenantId,
                changes,
                this.tenantContext.getUserId(),
            ),
        );

        return totoResponseMapper.toResponse(updated);
    }

    /**
     * Delete toto with cache invalidation
     */
    async delete(id: string): Promise<void> {
        const deleted = await this.totoRepository.delete(id);
        if (!deleted) {
            throw new NotFoundException(`Toto with ID ${id} not found`);
        }

        // Invalidate cache using RedisKeyBuilder
        const cacheKey = this.redisKeyBuilder.buildTenantKey('toto', `entity:${id}`);
        await this.redisService.del(cacheKey);

        this.logger.log(`Deleted toto: ${id}`);
    }

    /**
     * Upload file to S3 and associate with toto (OUTBOX PATTERN EXAMPLE)
     *
     * Demonstrates the Outbox Pattern with side effects:
     * 1. Upload file to S3 (external service, no transaction support)
     * 2. In a database transaction:
     *    a. Update toto entity with file URL
     *    b. Create side effect in outbox for SQS notification
     * 3. Background worker processes the outbox and sends SQS message
     *
     * Benefits:
     * - Guaranteed side effect execution (SQS message will be sent)
     * - Automatic retries with exponential backoff
     * - Transactional consistency (entity update + side effect creation are atomic)
     * - No distributed transaction required
     *
     * Rollback Strategy:
     * - If background worker fails after max retries, side effect status = 'failed'
     * - You can implement compensating actions (e.g., delete S3 file) in a separate handler
     * - For this example, failed side effects remain in the outbox for manual review
     *
     * Edge Case:
     * - If S3 upload succeeds but DB transaction fails, you'll have an orphaned S3 file
     * - Production solution: Implement S3 lifecycle policy to clean up orphaned files
     *   OR use a scheduled job to find and delete files not referenced in DB
     */
    @Transactional()
    async uploadFile(id: string, file: Buffer, filename: string): Promise<TotoResponse> {
        const toto = await this.totoRepository.findOne({ where: { id } });
        if (!toto) {
            throw new NotFoundException(`Toto with ID ${id} not found`);
        }

        // Step 1: Upload to S3 (outside DB transaction)
        const key = `totos/${id}/${filename}`;
        const result = await this.s3Service.upload(key, file, {
            contentType: 'application/octet-stream',
            metadata: {
                totoId: id,
                tenantId: toto.tenantId,
            },
        });

        // Step 2: Get transactional EntityManager
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Step 2a: Update entity with file URL (within transaction)
            toto.fileUrl = result.location;
            const updated = await queryRunner.manager.save(toto);

            // Step 2b: Create side effect in outbox (within same transaction)
            // This side effect will be processed by the background worker
            await this.sideEffectService.createSqsSideEffect(
                'toto',
                id,
                'toto.file.uploaded',
                'toto-file-processing-queue',
                {
                    totoId: id,
                    tenantId: toto.tenantId,
                    fileName: filename,
                    fileUrl: result.location,
                    s3Key: key,
                    uploadedAt: new Date().toISOString(),
                },
                { critical: true, manager: queryRunner.manager }, // Outbox with transaction
            );

            // Commit transaction (both entity update and side effect creation)
            await queryRunner.commitTransaction();

            // Step 3: Invalidate cache (after successful commit) using RedisKeyBuilder
            const cacheKey = this.redisKeyBuilder.buildTenantKey('toto', `entity:${id}`);
            await this.redisService.del(cacheKey);

            this.logger.log(
                `Uploaded file for toto: ${id} to S3: ${key} and created side effect in outbox`,
            );

            return totoResponseMapper.toResponse(updated);
        } catch (error) {
            // Rollback transaction if anything fails
            await queryRunner.rollbackTransaction();
            this.logger.error(`Failed to upload file for toto: ${id}`, (error as Error).stack);
            throw error;
        } finally {
            // Release query runner
            await queryRunner.release();
        }
    }

    /**
     * Download file from S3
     */
    async downloadFile(id: string): Promise<Buffer> {
        const toto = await this.totoRepository.findOne({ where: { id } });
        if (!toto) {
            throw new NotFoundException(`Toto with ID ${id} not found`);
        }

        if (!toto.fileUrl) {
            throw new NotFoundException(`No file associated with toto ${id}`);
        }

        // Extract S3 key from URL
        const key = `totos/${id}/${toto.fileUrl.split('/').pop()}`;
        const buffer = await this.s3Service.downloadAsBuffer(key);

        this.logger.log(`Downloaded file for toto: ${id} from S3`);

        return buffer;
    }

    /**
     * Fetch external data and cache in Redis
     * Demonstrates using RedisKeyBuilder with custom namespace for different data types
     */
    async fetchExternalData(id: string): Promise<any> {
        // Use RedisKeyBuilder with 'external-api' namespace for external data caching
        const cacheKey = this.redisKeyBuilder.buildTenantKey('external-api', `posts:${id}`);

        // Try cache first
        const cached = await this.redisService.get<any>(cacheKey);
        if (cached) {
            this.logger.debug(`Cache hit for external data: ${id}`);
            return cached;
        }

        // Fetch from external API
        const response: IHttpResponse<any> = await this.httpClient.get(
            `https://jsonplaceholder.typicode.com/posts/${id}`,
        );

        // Cache for 30 minutes
        await this.redisService.set(cacheKey, response.data, { ttl: 1800 });

        return response.data;
    }
}
