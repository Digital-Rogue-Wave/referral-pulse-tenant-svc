import { jest } from '@jest/globals';
import { ApiKeyMiddleware } from './api-key.middleware';
import { ApiKeyService } from '../api-key.service';
import { ClsService } from 'nestjs-cls';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Request, Response, NextFunction } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyEntity } from '../api-key.entity';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('ApiKeyMiddleware', () => {
    let middleware: ApiKeyMiddleware;
    let apiKeyService: DeepMocked<ApiKeyService>;
    let clsService: DeepMocked<ClsService<ClsRequestContext>>;

    beforeEach(() => {
        apiKeyService = createMock<ApiKeyService>();
        clsService = createMock<ClsService<ClsRequestContext>>();
        middleware = new ApiKeyMiddleware(apiKeyService, clsService);
    });

    it('should be defined', () => {
        expect(middleware).toBeDefined();
    });

    it('should call next() if no API key header is present', async () => {
        const req = { headers: {} } as Request;
        const res = {} as Response;
        const next = jest.fn() as NextFunction;

        await middleware.use(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(apiKeyService.validateKey).not.toHaveBeenCalled();
    });

    it('should set CLS context and call next() if valid API key is present', async () => {
        const apiKey = Stubber.stubOne(ApiKeyEntity, {
            id: 'key-1',
            tenantId: 'tenant-1',
            createdBy: 'user-1',
            scopes: ['read']
        });

        const req = {
            headers: { 'x-api-key': 'valid-key' },
            ip: '127.0.0.1',
            route: { path: '/test' }
        } as any;
        const res = {} as Response;
        const next = jest.fn() as NextFunction;

        apiKeyService.validateKey.mockResolvedValue(apiKey);

        await middleware.use(req, res, next);

        expect(apiKeyService.validateKey).toHaveBeenCalledWith('valid-key');
        expect(clsService.set).toHaveBeenCalledWith('tenantId', 'tenant-1');
        expect(clsService.set).toHaveBeenCalledWith('userId', 'user-1');
        expect(req['user']).toBeDefined();
        expect(req['user'].tenantId).toBe('tenant-1');
        expect(next).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if API key is invalid', async () => {
        const req = {
            headers: { 'x-api-key': 'invalid-key' }
        } as any;
        const res = {} as Response;
        const next = jest.fn() as NextFunction;

        apiKeyService.validateKey.mockResolvedValue(null);

        await expect(middleware.use(req, res, next)).rejects.toThrow(UnauthorizedException);
    });
});
