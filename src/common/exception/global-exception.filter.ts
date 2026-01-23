import { Catch, ExceptionFilter, ArgumentsHost, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Response, Request } from 'express';
import type { IErrorResponse } from '@app/types';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { DateService } from '@app/common/helper/date.service';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
    constructor(
        private readonly httpAdapterHost: HttpAdapterHost,
        private readonly tenantContext: ClsTenantContextService,
        private readonly dateService: DateService,
    ) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const { httpAdapter } = this.httpAdapterHost;
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        const response = ctx.getResponse<Response>();

        let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        let errorCode = 'INTERNAL_ERROR';
        let message = 'An unexpected error occurred';
        let details: unknown = undefined;

        if (exception instanceof HttpException) {
            statusCode = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
            } else if (typeof exceptionResponse === 'object') {
                const resp = exceptionResponse as Record<string, unknown>;
                message = (resp.message as string) || message;
                errorCode = (resp.error as string) || this.getErrorCodeFromStatus(statusCode);
                details = resp.details;
            }
            errorCode = this.getErrorCodeFromStatus(statusCode);
        } else if (exception instanceof Error) {
            message = exception.message;

            if ((exception as any).code === '23505') {
                statusCode = HttpStatus.CONFLICT;
                errorCode = 'DUPLICATE_RESOURCE';
                message = 'Resource already exists';
            } else if ((exception as any).code === '23503') {
                statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
                errorCode = 'FOREIGN_KEY_VIOLATION';
                message = 'Referenced resource does not exist';
            }
        }

        let requestId: string | undefined;
        let traceId: string | undefined;

        try {
            requestId = this.tenantContext.getRequestId();
            traceId = this.tenantContext.getTraceId();
        } catch {
            requestId = request.requestId || (request.headers['x-request-id'] as string);
        }

        const errorResponse: IErrorResponse = {
            statusCode,
            errorCode,
            message,
            details,
            timestamp: this.dateService.nowISO(),
            path: request.url,
            requestId: requestId || 'unknown',
            traceId,
        };

        console.error(`[${errorCode}] ${message}`, {
            statusCode,
            path: request.url,
            method: request.method,
            requestId,
            traceId,
            stack: exception instanceof Error ? exception.stack : undefined,
        });

        httpAdapter.reply(response, errorResponse, statusCode);
    }

    private getErrorCodeFromStatus(status: number): string {
        switch (status) {
            case 400: return 'VALIDATION_ERROR';
            case 401: return 'UNAUTHORIZED';
            case 403: return 'FORBIDDEN';
            case 404: return 'NOT_FOUND';
            case 409: return 'CONFLICT';
            case 422: return 'UNPROCESSABLE_ENTITY';
            case 429: return 'TOO_MANY_REQUESTS';
            case 503: return 'SERVICE_UNAVAILABLE';
            default: return 'INTERNAL_ERROR';
        }
    }
}
