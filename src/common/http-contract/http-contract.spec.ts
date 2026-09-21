import { CallHandler, ExecutionContext, HttpStatus, ValidationError } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mock } from 'jest-mock-extended';
import { Prisma } from '@prisma-gen/generated/client';
import { lastValueFrom, of, throwError } from 'rxjs';

import { BaseException } from '@common/exceptions/base.exceptions';
import { GlobalExceptionsFilter } from '@common/exceptions/global-exceptions.filter';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { DatabaseService } from '@app/database/database.service';

import { cursorPage } from './cursor-page';
import { requestIdMiddleware } from './request-id.middleware';
import { RequestIdempotencyInterceptor } from './request-idempotency.interceptor';
import { validationExceptionFactory } from './validation-exception.factory';
import { camelCaseKeys, snakeCaseKeys, toSnakeCase } from './wire-case';
import { WireCaseInterceptor } from './wire-case.interceptor';

describe('Wire case (API Contract v1.3 §1 — snake_case fields and parameters)', () => {
    it('converts keys both ways, deeply, without touching values', () => {
        const date = new Date('2026-09-21T10:00:00.000Z');
        const inside = { tenantId: 't1', createdAt: date, keyPrefix: 'abcd', nestedItems: [{ lastUsedAt: null, planName: 'growthPlan' }] };

        const wire = snakeCaseKeys(inside) as Record<string, unknown>;
        expect(wire).toEqual({
            tenant_id: 't1',
            created_at: date,
            key_prefix: 'abcd',
            nested_items: [{ last_used_at: null, plan_name: 'growthPlan' }]
        });
        expect(camelCaseKeys(wire)).toEqual(inside);
    });

    it('handles acronyms and digits the way a reader expects', () => {
        expect(toSnakeCase('apiKeyID')).toBe('api_key_id');
        expect(toSnakeCase('s3Url')).toBe('s3_url');
    });

    it('leaves Prisma decimals and buffers as values', () => {
        const decimal = new Prisma.Decimal('12.50');
        const buffer = Buffer.from('x');
        expect(snakeCaseKeys({ amountDue: decimal, rawBody: buffer })).toEqual({ amount_due: decimal, raw_body: buffer });
    });

    it('converts the request before validation and the response after the handler', async () => {
        const request = { body: { key_type: 'secret' }, query: { starting_after: 'x' } } as Record<string, unknown>;
        const context = {
            getType: () => 'http',
            getHandler: () => function handler() {},
            getClass: () => class Controller {},
            switchToHttp: () => ({ getRequest: () => request })
        } as unknown as ExecutionContext;
        const handler: CallHandler = { handle: () => of({ keyType: 'secret', createdBy: 'u1' }) };

        const result = await lastValueFrom(new WireCaseInterceptor(new Reflector()).intercept(context, handler));

        expect(request.body).toEqual({ keyType: 'secret' });
        expect(request.query).toEqual({ startingAfter: 'x' });
        expect(result).toEqual({ key_type: 'secret', created_by: 'u1' });
    });
});

describe('Error envelope (API Contract v1.3 §1 "Error Model")', () => {
    const run = (exception: unknown, requestId = 'req_1') => {
        const response = {
            setHeader: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            type: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const host = {
            switchToHttp: () => ({ getRequest: () => ({ requestId, method: 'GET', url: '/x', originalUrl: '/x' }), getResponse: () => response })
        };
        new GlobalExceptionsFilter(mock<AppLoggerService>(), mock<TenantContextService>()).catch(exception, host as never);
        return response;
    };

    it('returns { error: { type, code, message, param, request_id, doc_url } } with the X-Request-Id header', () => {
        const response = run(new BaseException('duplicate_resource', 'Slug taken', HttpStatus.CONFLICT, 'slugName'));

        expect(response.status).toHaveBeenCalledWith(409);
        expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', 'req_1');
        expect(response.json).toHaveBeenCalledWith({
            error: {
                type: 'conflict',
                code: 'duplicate_resource',
                message: 'Slug taken',
                param: 'slug_name',
                request_id: 'req_1',
                doc_url: 'https://docs.referralai.com/errors/duplicate_resource'
            }
        });
    });

    it.each([
        [400, 'invalid_request'],
        [401, 'authentication_error'],
        [403, 'authorization_error'],
        [404, 'not_found'],
        [422, 'unprocessable'],
        [429, 'rate_limit'],
        [500, 'internal_error']
    ])('maps HTTP %i to type %s', (status, type) => {
        const response = run(new BaseException('x' as never, 'x', status));
        expect(response.json.mock.calls[0][0].error.type).toBe(type);
    });

    it('sends Retry-After for an in-flight idempotency collision', () => {
        const response = run(new BaseException('idempotency_key_in_flight', 'busy', HttpStatus.CONFLICT, undefined, { retryAfterSeconds: 1 }));
        expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    });

    it('reports every failing field, with its full snake_case path, on validation errors', () => {
        const errors = [
            { property: 'label', constraints: { isString: 'label must be a string' }, children: [] },
            {
                property: 'branding',
                children: [{ property: 'primaryColor', constraints: { isHexColor: 'primaryColor must be a hex color' }, children: [] }]
            }
        ] as unknown as ValidationError[];

        const envelope = run(validationExceptionFactory(errors)).json.mock.calls[0][0].error;

        expect(envelope.type).toBe('invalid_request');
        expect(envelope.param).toBe('label');
        expect(envelope.details).toEqual([
            { param: 'label', message: 'label must be a string' },
            { param: 'branding.primary_color', message: 'primaryColor must be a hex color' }
        ]);
    });
});

describe('requestIdMiddleware', () => {
    const run = (header?: string) => {
        const request = { header: () => header, headers: {} } as never as {
            requestId?: string;
            header: () => string | undefined;
            headers: Record<string, string>;
        };
        const response = { setHeader: jest.fn() };
        requestIdMiddleware(request as never, response as never, jest.fn());
        return { request, response };
    };

    it('keeps a sane caller-supplied id and echoes it', () => {
        const { request, response } = run('req_gateway-123');
        expect(request.requestId).toBe('req_gateway-123');
        expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', 'req_gateway-123');
    });

    it.each([undefined, '', 'has spaces', 'x'.repeat(200), '<script>'])('generates a fresh id instead of %p', (header) => {
        expect(run(header).request.requestId).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    });
});

describe('cursorPage (API Contract v1.3 §1 "Pagination")', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `id-${String(i).padStart(2, '0')}` }));
    const delegate = {
        findMany: jest.fn(
            async ({
                where,
                orderBy,
                take
            }: {
                where: { AND: [object, { id?: { lt?: string; gt?: string } }] };
                orderBy: { id: string };
                take: number;
            }) => {
                const cursor = where.AND[1].id;
                const filtered = rows.filter((r) => (!cursor?.lt || r.id < cursor.lt) && (!cursor?.gt || r.id > cursor.gt));
                const sorted = [...filtered].sort((a, b) => (orderBy.id === 'desc' ? (a.id < b.id ? 1 : -1) : a.id < b.id ? -1 : 1));
                return sorted.slice(0, take);
            }
        )
    };

    it('returns the newest page first, with has_more and a next cursor', async () => {
        const page = await cursorPage(delegate, {}, { limit: 3 }, (r) => r.id);
        expect(page).toEqual({ data: ['id-06', 'id-05', 'id-04'], hasMore: true, nextCursor: 'id-04', prevCursor: null });
    });

    it('continues after a cursor and offers the way back', async () => {
        const page = await cursorPage(delegate, {}, { limit: 3, startingAfter: 'id-04' }, (r) => r.id);
        expect(page).toEqual({ data: ['id-03', 'id-02', 'id-01'], hasMore: true, nextCursor: 'id-01', prevCursor: 'id-03' });
    });

    it('pages backwards with ending_before, keeping newest-first order', async () => {
        const page = await cursorPage(delegate, {}, { limit: 2, endingBefore: 'id-02' }, (r) => r.id);
        expect(page).toEqual({ data: ['id-04', 'id-03'], hasMore: true, nextCursor: 'id-03', prevCursor: 'id-04' });
    });

    it('reports the last page', async () => {
        const page = await cursorPage(delegate, {}, { limit: 5, startingAfter: 'id-02' }, (r) => r.id);
        expect(page).toEqual({ data: ['id-01', 'id-00'], hasMore: false, nextCursor: null, prevCursor: 'id-01' });
    });
});

describe('RequestIdempotencyInterceptor (API Contract v1.3 §1, DB Model v2 §0.7)', () => {
    type Row = { requestFingerprint: string; responseStatus: number | null; responseBody: unknown; expiresAt: Date };
    let store: Map<string, Row>;
    let prisma: DatabaseService;
    let response: { setHeader: jest.Mock; status: jest.Mock };

    beforeEach(() => {
        store = new Map();
        response = { setHeader: jest.fn(), status: jest.fn() };
        const key = (w: { tenantId: string; idempotencyKey: string }) => `${w.tenantId}|${w.idempotencyKey}`;
        prisma = {
            idempotencyKey: {
                create: jest.fn(
                    async ({ data }: { data: { tenantId: string; idempotencyKey: string; requestFingerprint: string; expiresAt: Date } }) => {
                        if (store.has(key(data))) {
                            throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '7' });
                        }
                        store.set(key(data), {
                            requestFingerprint: data.requestFingerprint,
                            responseStatus: null,
                            responseBody: null,
                            expiresAt: data.expiresAt
                        });
                    }
                ),
                findUnique: jest.fn(
                    async ({ where }: { where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } } }) =>
                        store.get(key(where.tenantId_idempotencyKey)) ?? null
                ),
                update: jest.fn(
                    async ({
                        where,
                        data
                    }: {
                        where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } };
                        data: Partial<Row>;
                    }) => {
                        Object.assign(store.get(key(where.tenantId_idempotencyKey))!, data);
                    }
                ),
                deleteMany: jest.fn(async ({ where }: { where: { tenantId: string; idempotencyKey: string; responseStatus?: null } }) => {
                    const row = store.get(key(where));
                    if (row && (where.responseStatus !== null || row.responseStatus === null)) {
                        store.delete(key(where));
                    }
                })
            }
        } as unknown as DatabaseService;
    });

    const call = (opts: { key?: string; body?: object; method?: string; user?: object; handler?: CallHandler }) => {
        const request = {
            method: opts.method ?? 'POST',
            originalUrl: '/api/v1/api-keys',
            body: opts.body ?? { label: 'ci' },
            user: opts.user ?? { tenantId: 't1', userId: 'u1', source: 'dashboard' },
            header: (name: string) => (name === 'idempotency-key' ? opts.key : undefined)
        };
        const context = {
            getType: () => 'http',
            getHandler: () => function handler() {},
            getClass: () => class Controller {},
            switchToHttp: () => ({ getRequest: () => request, getResponse: () => response })
        } as unknown as ExecutionContext;
        const handler = opts.handler ?? { handle: () => of({ id: 'key-1', label: 'ci' }) };
        return lastValueFrom(new RequestIdempotencyInterceptor(new Reflector(), prisma).intercept(context, handler));
    };

    it('requires the header from dashboard callers on POST and PATCH', async () => {
        expect(() => call({})).toThrow(BaseException);
        expect(() => call({ method: 'PATCH' })).toThrow(BaseException);
    });

    it('does not require it for service callers (they dedupe on business keys) or for PUT/DELETE', async () => {
        await expect(call({ user: { isServiceToken: true, clientId: 'svc', source: 'client_credentials' } })).resolves.toEqual({
            id: 'key-1',
            label: 'ci'
        });
        await expect(call({ method: 'PUT' })).resolves.toBeDefined();
    });

    it('replays the original response for a retried request, without running the handler again', async () => {
        const handle = jest.fn(() => of({ id: 'key-1' }));
        await call({ key: 'k-1', handler: { handle } });
        const replay = await call({ key: 'k-1', handler: { handle } });

        expect(handle).toHaveBeenCalledTimes(1);
        expect(replay).toEqual({ id: 'key-1' });
        expect(response.setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
        expect(response.status).toHaveBeenCalledWith(201);
    });

    it('refuses the same key with a different body (409 collision)', async () => {
        await call({ key: 'k-2', body: { label: 'a' } });
        await expect(call({ key: 'k-2', body: { label: 'b' } })).rejects.toMatchObject({ code: 'idempotency_key_collision' });
    });

    it('refuses a retry while the first request is still running (409 in flight)', async () => {
        store.set('t1|k-3', { requestFingerprint: 'unused', responseStatus: null, responseBody: null, expiresAt: new Date(Date.now() + 60_000) });
        const busy = store.get('t1|k-3')!;
        busy.requestFingerprint = (await import('@common/helper/hashing')).sha256Hex(`POST /api/v1/api-keys ${JSON.stringify({ label: 'ci' })}`);

        await expect(call({ key: 'k-3' })).rejects.toMatchObject({ code: 'idempotency_key_in_flight' });
    });

    it('releases the key when the request fails, so the client can retry', async () => {
        await expect(call({ key: 'k-4', handler: { handle: () => throwError(() => new Error('boom')) } })).rejects.toThrow('boom');
        expect(store.has('t1|k-4')).toBe(false);
    });

    it('scopes keys per tenant — the same key in two tenants is two requests', async () => {
        await call({ key: 'shared', user: { tenantId: 't1', source: 'dashboard' } });
        await call({ key: 'shared', user: { tenantId: 't2', source: 'dashboard' }, body: { label: 'other' } });
        expect(store.size).toBe(2);
    });
});
