import { ArgumentsHost, BadRequestException, ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import Stripe from 'stripe';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

import { BaseException } from './base.exceptions';
import { ErrorEnvelope, GlobalExceptionsFilter } from './global-exceptions.filter';

/** The API Contract error body: `{ error: { type, code, message, param, request_id, doc_url, details } }`. */
describe('GlobalExceptionsFilter', () => {
    const capture = (exception: unknown, requestId: string | null = 'req_1') => {
        const response = { setHeader: jest.fn(), status: jest.fn(), type: jest.fn(), json: jest.fn() };
        response.setHeader.mockReturnValue(response);
        response.status.mockReturnValue(response);
        response.type.mockReturnValue(response);
        const host = {
            switchToHttp: () => ({
                getRequest: () => ({ requestId: requestId ?? undefined, method: 'POST', url: '/v1/x' }),
                getResponse: () => response
            })
        } as unknown as ArgumentsHost;
        const context = mock<TenantContextService>();
        context.getRequestId.mockReturnValue('req_ctx');
        new GlobalExceptionsFilter(mock<AppLoggerService>(), context).catch(exception, host);
        return {
            status: response.status.mock.calls[0]![0] as number,
            body: response.json.mock.calls[0]![0] as ErrorEnvelope,
            headers: Object.fromEntries(response.setHeader.mock.calls as Array<[string, string]>)
        };
    };
    const prismaError = (code: string, meta: Record<string, unknown> = {}) =>
        new PrismaClientKnownRequestError('db', { code, clientVersion: '7', meta });

    it('renders a domain exception with its code, param and request id, and a Retry-After when given', () => {
        const { status, body, headers } = capture(
            new BaseException('rate_limit_exceeded', 'Slow down', HttpStatus.TOO_MANY_REQUESTS, 'apiKeyId', { retryAfterSeconds: 30 })
        );

        expect(status).toBe(429);
        expect(body.error).toEqual({
            type: 'rate_limit',
            code: 'rate_limit_exceeded',
            message: 'Slow down',
            param: 'api_key_id',
            request_id: 'req_1',
            doc_url: 'https://docs.referralai.com/errors/rate_limit_exceeded'
        });
        expect(headers).toMatchObject({ 'Retry-After': '30', 'X-Request-Id': 'req_1' });
    });

    it('lists field errors from a validation exception, snake-cased', () => {
        const { body } = capture(
            new BaseException('validation_failed', 'Invalid', HttpStatus.BAD_REQUEST, undefined, {
                errors: [{ field: 'retentionMonths', message: 'too low' }]
            })
        );
        expect(body.error).toMatchObject({
            type: 'invalid_request',
            param: 'retention_months',
            details: [{ param: 'retention_months', message: 'too low' }]
        });
    });

    it.each([
        ['P2002', { target: ['tenant_id', 'email'] }, 409, 'duplicate_resource'],
        ['P2025', {}, 404, 'resource_not_found'],
        ['P2003', { field_name: 'plan_id' }, 400, 'foreign_key_violation'],
        ['P9999', {}, 500, 'database_error']
    ])('maps Prisma %s to %i %s without leaking the database message', (code, meta, status, errorCode) => {
        const result = capture(prismaError(code, meta));
        expect(result.status).toBe(status);
        expect(result.body.error.code).toBe(errorCode);
        expect(result.body.error.message).not.toContain('db');
    });

    it('maps Nest HTTP exceptions, including class-validator message lists', () => {
        expect(capture(new NotFoundException('Tenant t1 not found')).body.error).toMatchObject({ type: 'not_found', message: 'Tenant t1 not found' });
        expect(capture(new ForbiddenException()).body.error.type).toBe('authorization_error');
        expect(capture(new HttpException('plain', HttpStatus.CONFLICT)).body.error).toMatchObject({ type: 'conflict', message: 'plain' });

        const validation = capture(new BadRequestException({ message: ['email must be an email', 'name should not be empty'] })).body.error;
        expect(validation).toMatchObject({ code: 'validation_failed', details: [{ param: 'email' }, { param: 'name' }] });
    });

    it.each([
        [{ type: 'card_error', code: 'card_declined', message: 'Your card was declined.' }, 402, 'card_declined', 'Your card was declined.'],
        [{ type: 'invalid_request_error', code: 'resource_missing', message: 'No such subscription: sub_x' }, 404, 'not_found', undefined],
        [{ type: 'api_error', message: 'Stripe is down' }, 502, 'payment_provider_error', undefined]
    ])('maps a Stripe %p to %i %s, never a 500 (US1.8.2 F5)', (raw, status, code, message) => {
        const result = capture(Stripe.errors.StripeError.generate(raw as never));
        expect(result.status).toBe(status);
        expect(result.body.error.code).toBe(code);
        if (message) {
            expect(result.body.error.message).toBe(message);
        } else {
            expect(result.body.error.message).not.toContain('sub_x');
        }
    });

    it('hides unexpected errors behind a 500 with no internals', () => {
        const { status, body } = capture(new TypeError('secret stack detail'), null);
        expect(status).toBe(500);
        expect(body.error).toMatchObject({ type: 'internal_error', request_id: 'req_ctx' });
        expect(JSON.stringify(body)).not.toContain('secret stack detail');
    });
});
