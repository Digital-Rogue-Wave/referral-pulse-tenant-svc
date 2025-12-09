import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    constructor(private readonly logger: AppLoggingService) {}

    catch(exception: any, host: ArgumentsHost) {
        const exceptionHandlers: Record<string, (exception: any, host: ArgumentsHost) => void> = {
            HttpException: this.handleHttpException.bind(this),
            EntityNotFoundError: this.handleEntityNotFoundError.bind(this),
            QueryFailedError: this.handleQueryFailedError.bind(this)
        };
        const handler = exceptionHandlers[exception.constructor.name];
        if (handler) {
            handler(exception, host);
        } else {
            this.handleUnknownException(exception, host);
        }
    }

    handleHttpException(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const status = exception.getStatus();

        this.logError(request, 'HttpException', exception);

        void response.status(status).send({
            status: false,
            statusCode: status,
            path: request.url,
            request_id: request?.requestId,
            message: exception.getResponse(),
            stack: exception.stack
        });
    }

    private handleEntityNotFoundError(exception: EntityNotFoundError, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const status = HttpStatus.PRECONDITION_FAILED; // EntityNotFoundError is treated as 404

        this.logError(request, 'EntityNotFoundError', exception);

        void response.status(status).send({
            status: false,
            statusCode: status,
            path: request.url,
            request_id: request?.requestId,
            message: {
                status: HttpStatus.PRECONDITION_FAILED,
                errors: {
                    entity: exception.message
                }
            },
            stack: exception.stack
        });
    }

    private handleQueryFailedError(exception: QueryFailedError, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const status = HttpStatus.CONFLICT;

        this.logError(request, 'QueryFailedError', exception);

        void response.status(status).send({
            status: false,
            statusCode: status,
            path: request.url,
            request_id: request?.requestId,
            message: {
                status: HttpStatus.CONFLICT,
                errors: {
                    query: exception.message
                }
            },
            stack: exception.stack
        });
    }

    private handleUnknownException(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const status = HttpStatus.INTERNAL_SERVER_ERROR; // Default to 500 for unknown exceptions

        this.logError(request, 'UnknownException', exception);

        void response.status(status).send({
            status: false,
            statusCode: status,
            path: request.url,
            request_id: request?.requestId,
            message: {
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                errors: {
                    message: exception instanceof Error ? exception.message : 'Unknown'
                }
            },
            stack: exception instanceof Error ? exception.stack : null
        });
    }

    private logError(request: any, exceptionType: string, exception: unknown) {
        this.logger.fatal(
            exceptionType,
            {
                description: request?.url,
                path: request?.url,
                class: exceptionType,
                function: 'exception',
            },
            exception,
        );
    }
}
