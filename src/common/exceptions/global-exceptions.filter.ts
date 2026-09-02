import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

import type { Request, Response } from 'express';

import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

import type { IApiError, IErrorResponse, IValidationErrorDetail } from '@app/types';

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
    constructor(
        private readonly logger: AppLoggerService,
        private readonly tenantContext: TenantContextService
    ) {
        this.logger.setContext(GlobalExceptionsFilter.name);
    }

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        const response = ctx.getResponse<Response>();

        // Get IDs from ALS context
        const requestId = this.tenantContext.getRequestId() ?? 'unknown';
        const correlationId = this.tenantContext.getCorrelationId();

        let status: HttpStatus;
        let apiError: IApiError;

        // Handle custom BaseException
        if (exception instanceof BaseException) {
            ({ status, apiError } = this.handleBaseException(exception, requestId, correlationId));
        }
        // Handle Prisma errors
        else if (exception instanceof PrismaClientKnownRequestError) {
            ({ status, apiError } = this.handlePrismaError(exception, requestId, correlationId));
        }
        // Handle NestJS HttpException
        else if (exception instanceof HttpException) {
            ({ status, apiError } = this.handleHttpException(exception, requestId, correlationId));
        }
        // Handle unknown errors
        else {
            ({ status, apiError } = this.handleUnknownError(requestId, correlationId));
        }

        // Log error
        this.logError(request, status, apiError, exception);

        // Build response
        const errorResponse: IErrorResponse = { error: apiError };

        // Send response with X-Request-Id header
        response.setHeader('X-Request-Id', requestId).status(status).json(errorResponse);
    }

    private handleBaseException(exception: BaseException, requestId: string, correlationId?: string): { status: HttpStatus; apiError: IApiError } {
        const exceptionResponse = exception.getResponse() as {
            code: string;
            message: string;
            param?: string;
            details?: Record<string, unknown>;
        };

        const apiError: IApiError = {
            code: exceptionResponse.code,
            message: exceptionResponse.message,
            requestId,
            correlationId
        };

        if (exceptionResponse.param) {
            apiError.param = exceptionResponse.param;
        }

        // Handle validation details array
        if (exceptionResponse.details?.errors && Array.isArray(exceptionResponse.details.errors)) {
            apiError.details = exceptionResponse.details.errors as IValidationErrorDetail[];
        }

        return { status: exception.getStatus(), apiError };
    }

    private handlePrismaError(
        exception: PrismaClientKnownRequestError,
        requestId: string,
        correlationId?: string
    ): { status: HttpStatus; apiError: IApiError } {
        let status: HttpStatus;
        let code: string;
        let message: string;
        let param: string | undefined;

        switch (exception.code) {
            case 'P2002': {
                // Unique constraint violation
                status = HttpStatus.CONFLICT;
                code = 'duplicate_resource';
                const field = (exception.meta?.target as string[])?.join(', ') ?? 'field';
                message = `A record with this ${field} already exists`;
                param = field;
                break;
            }

            case 'P2025':
                // Record not found
                status = HttpStatus.NOT_FOUND;
                code = 'resource_not_found';
                message = (exception.meta?.cause as string) ?? 'Record not found';
                break;

            case 'P2003': {
                // Foreign key constraint violation
                status = HttpStatus.BAD_REQUEST;
                code = 'foreign_key_violation';
                message = 'Referenced record does not exist';
                const fkField = exception.meta?.field_name as string | undefined;
                if (fkField) {
                    param = fkField;
                }
                break;
            }

            default:
                status = HttpStatus.INTERNAL_SERVER_ERROR;
                code = 'database_error';
                message = 'A database error occurred';
        }

        const apiError: IApiError = {
            code,
            message,
            requestId,
            correlationId
        };

        if (param) {
            apiError.param = param;
        }

        return { status, apiError };
    }

    private handleHttpException(exception: HttpException, requestId: string, correlationId?: string): { status: HttpStatus; apiError: IApiError } {
        const status = exception.getStatus();
        const exceptionResponse = exception.getResponse();

        let message: string;
        let code: string;
        let details: IValidationErrorDetail[] | undefined;

        if (typeof exceptionResponse === 'string') {
            message = exceptionResponse;
            code = this.statusToCode(status);
        } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
            const responseObj = exceptionResponse as Record<string, unknown>;
            message = (responseObj.message as string) ?? exception.message;

            // Handle class-validator errors (array of validation messages)
            if (Array.isArray(responseObj.message)) {
                code = 'validation_failed';
                message = 'Validation failed';
                details = (responseObj.message as string[]).map((msg) => ({
                    field: this.extractFieldFromValidationMessage(msg),
                    message: msg
                }));
            } else {
                code = this.statusToCode(status);
            }
        } else {
            message = exception.message;
            code = this.statusToCode(status);
        }

        const apiError: IApiError = {
            code,
            message,
            requestId,
            correlationId
        };

        if (details) {
            apiError.details = details;
        }

        return { status, apiError };
    }

    private handleUnknownError(requestId: string, correlationId?: string): { status: HttpStatus; apiError: IApiError } {
        const apiError: IApiError = {
            code: 'internal_error',
            message: 'An unexpected error occurred',
            requestId,
            correlationId
        };

        return { status: HttpStatus.INTERNAL_SERVER_ERROR, apiError };
    }

    private logError(request: Request, status: HttpStatus, apiError: IApiError, exception: unknown): void {
        const logContext = {
            method: request.method,
            url: request.url,
            requestId: apiError.requestId,
            correlationId: apiError.correlationId,
            code: apiError.code,
            status,
            tenantId: this.tenantContext.getTenantId(),
            userId: this.tenantContext.getUserId()
        };

        if (status >= 500) {
            this.logger.error(
                `${request.method} ${request.url} ${status} - ${apiError.message}`,
                exception instanceof Error ? exception.stack : String(exception),
                logContext
            );
        } else {
            this.logger.warn(`${request.method} ${request.url} ${status} - ${apiError.message}`, logContext);
        }
    }

    /**
     * Map HTTP status to error code
     */
    private statusToCode(status: HttpStatus): string {
        const statusMap: Record<number, string> = {
            [HttpStatus.BAD_REQUEST]: 'invalid_request',
            [HttpStatus.UNAUTHORIZED]: 'authentication_error',
            [HttpStatus.FORBIDDEN]: 'authorization_error',
            [HttpStatus.NOT_FOUND]: 'not_found',
            [HttpStatus.CONFLICT]: 'conflict',
            [HttpStatus.UNPROCESSABLE_ENTITY]: 'invalid_request',
            [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limit_exceeded',
            [HttpStatus.INTERNAL_SERVER_ERROR]: 'internal_error',
            [HttpStatus.SERVICE_UNAVAILABLE]: 'service_unavailable'
        };

        return statusMap[status] ?? 'internal_error';
    }

    /**
     * Extract field name from class-validator error message
     * Example: "email must be a valid email" -> "email"
     */
    private extractFieldFromValidationMessage(message: string): string {
        const match = message.match(/^(\w+)\s/);
        return match?.[1] ?? 'unknown';
    }
}
