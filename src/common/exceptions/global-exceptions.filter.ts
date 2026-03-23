import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

import { Request, Response } from 'express';

import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

interface ProblemDetail {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    errorCode?: string;
    correlationId?: string;
    timestamp: string;
    errors?: string[];
}

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
    constructor(
        private readonly logger: AppLoggerService,
        private readonly tenantContext: TenantContextService,
    ) {
        this.logger.setContext(GlobalExceptionsFilter.name);
    }

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        const reply = ctx.getResponse<Response>();

        const correlationId = this.tenantContext.getCorrelationId() ?? 'unknown';
        const instance = request.url;
        const timestamp = new Date().toISOString();

        let problemDetail: ProblemDetail;

        // Handle custom BaseException
        if (exception instanceof BaseException) {
            problemDetail = this.handleBaseException(exception, instance, correlationId, timestamp);
        }
        // Handle Prisma errors
        /*else if (exception instanceof PrismaClientKnownRequestError) {
      problemDetail = this.handlePrismaError(
        exception,
        instance,
        correlationId,
        timestamp,
      );
    }*/
        // Handle NestJS HttpException
        else if (exception instanceof HttpException) {
            problemDetail = this.handleHttpException(exception, instance, correlationId, timestamp);
        }
        // Handle unknown errors
        else {
            problemDetail = this.handleUnknownError(exception, instance, correlationId, timestamp);
        }

        // Log error
        this.logError(request, problemDetail, exception);

        // Send response
        reply.status(problemDetail.status).send(problemDetail);
    }

    private handleBaseException(
        exception: BaseException,
        instance: string,
        correlationId: string,
        timestamp: string,
    ): ProblemDetail {
        const response = exception.getResponse() as {
            errorCode: string;
            message: string;
            details?: Record<string, unknown>;
        };

        return {
            type: 'about:blank',
            title: this.getHttpStatusText(exception.getStatus()),
            status: exception.getStatus(),
            detail: response.message,
            instance,
            errorCode: response.errorCode,
            correlationId,
            timestamp,
            ...(response.details?.errors ? { errors: response.details.errors as string[] } : {}),
        };
    }

    /*
  private handlePrismaError(
    exception: PrismaClientKnownRequestError,
    instance: string,
    correlationId: string,
    timestamp: string,
  ): ProblemDetail {
    let status: HttpStatus;
    let errorCode: string;
    let detail: string;

    switch (exception.code) {
      case 'P2002':
        // Unique constraint violation
        status = HttpStatus.CONFLICT;
        errorCode = 'DUPLICATE_RECORD';
        const field = (exception.meta?.target as string[])?.join(', ') ?? 'field';
        detail = `A record with this ${field} already exists`;
        break;

      case 'P2025':
        // Record not found
        status = HttpStatus.NOT_FOUND;
        errorCode = 'RECORD_NOT_FOUND';
        detail = exception.meta?.cause as string ?? 'Record not found';
        break;

      case 'P2003':
        // Foreign key constraint violation
        status = HttpStatus.BAD_REQUEST;
        errorCode = 'FOREIGN_KEY_VIOLATION';
        detail = 'Referenced record does not exist';
        break;

      default:
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        errorCode = 'DATABASE_ERROR';
        detail = 'A database error occurred';
    }

    return {
      type: 'about:blank',
      title: this.getHttpStatusText(status),
      status,
      detail,
      instance,
      errorCode,
      correlationId,
      timestamp,
    };
  }

  */
    private handleHttpException(
        exception: HttpException,
        instance: string,
        correlationId: string,
        timestamp: string,
    ): ProblemDetail {
        const status = exception.getStatus();
        const response = exception.getResponse();

        let detail: string;
        let errors: string[] | undefined;

        if (typeof response === 'string') {
            detail = response;
        } else if (typeof response === 'object' && response !== null) {
            const responseObj = response as Record<string, unknown>;
            detail = (responseObj.message as string) ?? exception.message;

            // Handle class-validator errors
            if (Array.isArray(responseObj.message)) {
                errors = responseObj.message as string[];
                detail = 'Validation failed';
            }
        } else {
            detail = exception.message;
        }

        return {
            type: 'about:blank',
            title: this.getHttpStatusText(status),
            status,
            detail,
            instance,
            errorCode: 'HTTP_ERROR',
            correlationId,
            timestamp,
            ...(errors && { errors }),
        };
    }

    private handleUnknownError(
        _exception: unknown,
        instance: string,
        correlationId: string,
        timestamp: string,
    ): ProblemDetail {
        return {
            type: 'about:blank',
            title: 'Internal Server Error',
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            detail: 'An unexpected error occurred',
            instance,
            errorCode: 'INTERNAL_ERROR',
            correlationId,
            timestamp,
        };
    }

    private logError(request: Request, problemDetail: ProblemDetail, exception: unknown): void {
        const logContext = {
            method: request.method,
            url: request.url,
            correlationId: problemDetail.correlationId,
            errorCode: problemDetail.errorCode,
            status: problemDetail.status,
        };

        if (problemDetail.status >= 500) {
            this.logger.error(
                `${request.method} ${request.url} ${problemDetail.status}`,
                exception instanceof Error ? exception.stack : String(exception),
                logContext,
            );
        } else {
            this.logger.warn(
                `${request.method} ${request.url} ${problemDetail.status} - ${problemDetail.detail}`,
                logContext,
            );
        }
    }

    private getHttpStatusText(status: number): string {
        const statusTexts: Record<number, string> = {
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            404: 'Not Found',
            409: 'Conflict',
            422: 'Unprocessable Entity',
            500: 'Internal Server Error',
            502: 'Bad Gateway',
            503: 'Service Unavailable',
        };

        return statusTexts[status] ?? 'Error';
    }
}
