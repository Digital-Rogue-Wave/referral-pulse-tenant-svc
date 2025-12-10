import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { register } from 'prom-client';

describe('TenantController (e2e)', () => {
    let app: INestApplication;

    beforeEach(async () => {
        register.clear();
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule]
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('/live (GET)', () => {
        const server = app.getHttpServer();
        // const router = server._events.request._router;
        // console.log(router.stack.filter(layer => layer.route).map(layer => layer.route.path));
        return request(server).get('/live').expect(200);
    });

    it('/webhook/ory/signup (POST)', () => {
        return request(app.getHttpServer())
            .post('/webhook/ory/signup')
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
