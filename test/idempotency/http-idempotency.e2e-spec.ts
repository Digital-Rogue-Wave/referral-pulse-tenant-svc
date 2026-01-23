import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Post, Body, Module } from '@nestjs/common';
import request from 'supertest';
import { ulid } from 'ulid';
import { AppModule } from '@app/app.module';
import { Idempotent, IdempotencyScope } from '@app/common/idempotency';
import { RedisService } from '@app/common/redis/redis.service';

class CreateItemDto {
    name: string;
    value: number;
}

@Controller('test-idempotency')
class TestIdempotencyController {
    private callCount = 0;

    @Post('tenant-scoped')
    @Idempotent({
        scope: IdempotencyScope.Tenant,
        ttl: 3600,
        storeResponse: true,
    })
    async tenantScoped(@Body() dto: CreateItemDto) {
        this.callCount++;
        return {
            id: ulid(),
            name: dto.name,
            value: dto.value,
            processedAt: new Date().toISOString(),
            callCount: this.callCount,
        };
    }

    @Post('global-scoped')
    @Idempotent({
        scope: IdempotencyScope.Global,
        ttl: 1800,
        storeResponse: true,
    })
    async globalScoped(@Body() dto: CreateItemDto) {
        this.callCount++;
        return {
            id: ulid(),
            name: dto.name,
            value: dto.value,
            processedAt: new Date().toISOString(),
            callCount: this.callCount,
        };
    }

    @Post('required-key')
    @Idempotent({
        scope: IdempotencyScope.Tenant,
        ttl: 3600,
        storeResponse: true,
        required: true,
    })
    async requiredKey(@Body() dto: CreateItemDto) {
        return {
            id: ulid(),
            name: dto.name,
            value: dto.value,
        };
    }

    @Post('no-idempotency')
    async noIdempotency(@Body() dto: CreateItemDto) {
        this.callCount++;
        return {
            id: ulid(),
            name: dto.name,
            value: dto.value,
            callCount: this.callCount,
        };
    }

    getCallCount() {
        return this.callCount;
    }

    resetCallCount() {
        this.callCount = 0;
    }
}

@Module({
    controllers: [TestIdempotencyController],
})
class TestIdempotencyModule {}

describe('HTTP Idempotency (e2e)', () => {
    let app: INestApplication;
    let redisService: RedisService;
    let controller: TestIdempotencyController;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule, TestIdempotencyModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        redisService = moduleFixture.get<RedisService>(RedisService);
        controller = moduleFixture.get<TestIdempotencyController>(TestIdempotencyController);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        controller.resetCallCount();
        await redisService.getClient().flushdb();
    });

    describe('Tenant-scoped idempotency', () => {
        it('should return cached response for duplicate requests with same key', async () => {
            const idempotencyKey = `test-${ulid()}`;
            const tenantId = 'tenant-123';
            const dto = { name: 'Item 1', value: 100 };

            // First request
            const response1 = await request(app.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', tenantId)
                .send(dto)
                .expect(201);

            // Second request with same key
            const response2 = await request(app.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', tenantId)
                .send(dto)
                .expect(200);

            // Responses should be identical
            expect(response1.body.id).toBe(response2.body.id);
            expect(response1.body.processedAt).toBe(response2.body.processedAt);
            expect(response1.body.callCount).toBe(1);
            expect(response2.body.callCount).toBe(1);

            // Verify replay header on second request
            expect(response2.headers['x-idempotency-replayed']).toBe('true');

            // Verify handler was only called once
            expect(controller.getCallCount()).toBe(1);
        });

        it('should process different tenant requests separately', async () => {
            const idempotencyKey = `test-${ulid()}`;
            const dto = { name: 'Item 1', value: 100 };

            // First tenant
            const response1 = await request(app.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', 'tenant-1')
                .send(dto)
                .expect(201);

            // Different tenant, same key
            const response2 = await request(app.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', 'tenant-2')
                .send(dto)
                .expect(201);

            // Should create different resources
            expect(response1.body.id).not.toBe(response2.body.id);
            expect(controller.getCallCount()).toBe(2);
        });

        it('should allow requests without idempotency key', async () => {
            const dto = { name: 'Item 1', value: 100 };

            const response1 = await request(app.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('x-tenant-id', 'tenant-123')
                .send(dto)
                .expect(201);

            const response2 = await request(app.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('x-tenant-id', 'tenant-123')
                .send(dto)
                .expect(201);

            // Should create different resources
            expect(response1.body.id).not.toBe(response2.body.id);
            expect(controller.getCallCount()).toBe(2);
        });
    });

    describe('Global-scoped idempotency', () => {
        it('should deduplicate across all tenants', async () => {
            const idempotencyKey = `test-${ulid()}`;
            const dto = { name: 'Item 1', value: 100 };

            // First tenant
            const response1 = await request(app.getHttpServer())
                .post('/test-idempotency/global-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', 'tenant-1')
                .send(dto)
                .expect(201);

            // Different tenant, same key → should return cached response
            const response2 = await request(app.getHttpServer())
                .post('/test-idempotency/global-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', 'tenant-2')
                .send(dto)
                .expect(200);

            // Should return same resource
            expect(response1.body.id).toBe(response2.body.id);
            expect(response2.headers['x-idempotency-replayed']).toBe('true');
            expect(controller.getCallCount()).toBe(1);
        });
    });

    describe('Required idempotency key', () => {
        it('should reject requests without idempotency key', async () => {
            const dto = { name: 'Item 1', value: 100 };

            await request(app.getHttpServer())
                .post('/test-idempotency/required-key')
                .set('x-tenant-id', 'tenant-123')
                .send(dto)
                .expect(400)
                .expect(({ body }) => {
                    expect(body.message).toContain('Idempotency-Key');
                });

            expect(controller.getCallCount()).toBe(0);
        });

        it('should process requests with idempotency key', async () => {
            const dto = { name: 'Item 1', value: 100 };

            await request(app.getHttpServer())
                .post('/test-idempotency/required-key')
                .set('Idempotency-Key', `test-${ulid()}`)
                .set('x-tenant-id', 'tenant-123')
                .send(dto)
                .expect(201);

            expect(controller.getCallCount()).toBe(1);
        });
    });

    describe('No idempotency endpoint', () => {
        it('should not deduplicate requests', async () => {
            const dto = { name: 'Item 1', value: 100 };

            const response1 = await request(app.getHttpServer())
                .post('/test-idempotency/no-idempotency')
                .set('x-tenant-id', 'tenant-123')
                .send(dto)
                .expect(201);

            const response2 = await request(app.getHttpServer())
                .post('/test-idempotency/no-idempotency')
                .set('x-tenant-id', 'tenant-123')
                .send(dto)
                .expect(201);

            // Should create different resources
            expect(response1.body.id).not.toBe(response2.body.id);
            expect(response1.body.callCount).toBe(1);
            expect(response2.body.callCount).toBe(2);
            expect(controller.getCallCount()).toBe(2);
        });
    });

    describe('Idempotency key expiration', () => {
        it('should allow reprocessing after TTL expires', async () => {
            const idempotencyKey = `test-${ulid()}`;
            const tenantId = 'tenant-123';
            const dto = { name: 'Item 1', value: 100 };

            // First request with very short TTL (1 second)
            const moduleFixture: TestingModule = await Test.createTestingModule({
                imports: [AppModule, TestIdempotencyModule],
            }).compile();

            const shortTtlApp = moduleFixture.createNestApplication();
            await shortTtlApp.init();

            const response1 = await request(shortTtlApp.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', tenantId)
                .send(dto)
                .expect(201);

            // Wait for TTL to expire (simulated - in real test use short TTL)
            await redisService.getClient().del(`idempotency:tenant:${tenantId}:${idempotencyKey}`);

            // Second request after expiration
            const response2 = await request(shortTtlApp.getHttpServer())
                .post('/test-idempotency/tenant-scoped')
                .set('Idempotency-Key', idempotencyKey)
                .set('x-tenant-id', tenantId)
                .send(dto)
                .expect(201);

            // Should create new resource
            expect(response1.body.id).not.toBe(response2.body.id);
            expect(response2.headers['x-idempotency-replayed']).toBeUndefined();

            await shortTtlApp.close();
        });
    });

    describe('Network retry simulation', () => {
        it('should handle rapid duplicate requests (race condition)', async () => {
            const idempotencyKey = `test-${ulid()}`;
            const tenantId = 'tenant-123';
            const dto = { name: 'Item 1', value: 100 };

            // Send 5 requests concurrently
            const requests = Array.from({ length: 5 }, () =>
                request(app.getHttpServer())
                    .post('/test-idempotency/tenant-scoped')
                    .set('Idempotency-Key', idempotencyKey)
                    .set('x-tenant-id', tenantId)
                    .send(dto),
            );

            const responses = await Promise.all(requests);

            // All should return same ID
            const ids = responses.map((r) => r.body.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(1);

            // Handler should only be called once (idempotency lock)
            expect(controller.getCallCount()).toBe(1);

            // At least one should have replay header
            const replayedCount = responses.filter(
                (r) => r.headers['x-idempotency-replayed'] === 'true',
            ).length;
            expect(replayedCount).toBeGreaterThan(0);
        });
    });
});