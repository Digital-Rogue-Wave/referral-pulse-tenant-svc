import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '@mod/app.module';
import { register } from 'prom-client';
import { ConfigService } from '@nestjs/config';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AgnosticTenantService } from '@mod/tenant/agnostic/agnostic-tenant.service';
import { BillingService } from '@mod/billing/billing.service';
import { DataSource } from 'typeorm';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisPubSubService } from '@mod/common/aws-redis/redis-pubsub.service';
import { SesService } from '@mod/common/aws-ses/ses.service';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { KetoService } from '@mod/common/auth/keto.service';
import { KratosService } from '@mod/common/auth/kratos.service';
import { S3Service } from '@mod/common/aws-s3/s3.service';

describe('TenantController (e2e)', () => {
    let app: INestApplication;
    let agnosticTenantService: DeepMocked<AgnosticTenantService>;
    let billingService: DeepMocked<BillingService>;
    let configService: DeepMocked<ConfigService>;
    let dataSource: DeepMocked<DataSource>;
    let redisService: DeepMocked<RedisService>;
    let redisPubSubService: DeepMocked<RedisPubSubService>;
    let sesService: DeepMocked<SesService>;
    let snsPublisher: DeepMocked<SnsPublisher>;
    let ketoService: DeepMocked<KetoService>;
    let kratosService: DeepMocked<KratosService>;
    let s3Service: DeepMocked<S3Service>;

    beforeEach(async () => {
        register.clear();
        agnosticTenantService = createMock<AgnosticTenantService>();
        billingService = createMock<BillingService>();
        configService = createMock<ConfigService>();
        dataSource = createMock<DataSource>();
        redisService = createMock<RedisService>();
        redisPubSubService = createMock<RedisPubSubService>();
        sesService = createMock<SesService>();
        snsPublisher = createMock<SnsPublisher>();
        ketoService = createMock<KetoService>();
        kratosService = createMock<KratosService>();
        s3Service = createMock<S3Service>();

        configService.get.mockImplementation((key: string) => {
            if (key === 'appConfig.apiPrefix') {
                return 'api';
            }
            if (key === 'ORY_WEBHOOK_API_KEY') {
                return 'test-key';
            }
            if (key === 'tracingConfig.enabled') return false;
            if (key === 'awsConfig.region') return 'us-east-1';
            if (key === 's3Config.sse') return 'AES256';
            if (key === 'oryConfig') {
                return {
                    hydra: { jwksUrl: 'http://jwks', tokenUrl: 'http://token' },
                    kratos: { publicUrl: 'http://kratos', adminUrl: 'http://kratos-admin' },
                    keto: { readUrl: 'http://keto-read', writeUrl: 'http://keto-write' },
                    audience: 'test'
                };
            }
            return undefined;
        });

        configService.getOrThrow.mockImplementation((key: string) => {
            if (key === 'appConfig.apiPrefix') return 'api';
            if (key === 'ORY_WEBHOOK_API_KEY') return 'test-key';
            if (key === 'appConfig.headerLanguage') return 'x-custom-lang';
            if (key === 'appConfig.port') return 3000;
            if (key === 'appConfig.name') return 'test-app';
            if (key === 'appConfig.fallbackLanguage') return 'en';
            if (key === 'awsConfig.region') return 'us-east-1';
            if (key === 'databaseConfig.type') return 'postgres';
            if (key === 'oryConfig') {
                return {
                    hydra: { jwksUrl: 'http://jwks', tokenUrl: 'http://token' },
                    kratos: { publicUrl: 'http://kratos', adminUrl: 'http://kratos-admin' },
                    keto: { readUrl: 'http://keto-read', writeUrl: 'http://keto-write' },
                    audience: 'test'
                };
            }
            return '';
        });

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule]
        })
            .overrideProvider(AgnosticTenantService)
            .useValue(agnosticTenantService)
            .overrideProvider(BillingService)
            .useValue(billingService)
            .overrideProvider(ConfigService)
            .useValue(configService)
            .overrideProvider(DataSource)
            .useValue(dataSource)
            .overrideProvider(RedisService)
            .useValue(redisService)
            .overrideProvider(RedisPubSubService)
            .useValue(redisPubSubService)
            .overrideProvider(SesService)
            .useValue(sesService)
            .overrideProvider(SnsPublisher)
            .useValue(snsPublisher)
            .overrideProvider(KetoService)
            .useValue(ketoService)
            .overrideProvider(KratosService)
            .useValue(kratosService)
            .overrideProvider(S3Service)
            .useValue(s3Service)
            .compile();

        app = moduleFixture.createNestApplication();
        // const configService = app.get(ConfigService); // This line is now redundant as we have our mocked configService
        const apiPrefix = configService.getOrThrow('appConfig.apiPrefix', { infer: true }) || 'api';
        app.setGlobalPrefix(apiPrefix, { exclude: ['/', '/live', '/ready', '/startup'] });
        app.enableVersioning({ type: VersioningType.URI });
        await app.init();
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
    });

    it('/health/live (GET)', () => {
        return request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    });

    it('/webhook/ory/signup (POST)', () => {
        agnosticTenantService.create.mockResolvedValue({ id: 'tenant-123' } as any);
        return request(app.getHttpServer())
            .post('/api/v1/webhook/ory/signup')
            .set('x-ory-api-key', 'test-key')
            .send({
                identity: {
                    id: 'user-123',
                    traits: {
                        name: { first: 'John', last: 'Doe' },
                        company_name: 'Acme Corp'
                    }
                }
            })
            .expect(201);
    });
});
