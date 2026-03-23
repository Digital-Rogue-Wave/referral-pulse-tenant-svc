# NestJS Enterprise Patterns

Exception handling, validation, and API versioning patterns for NestJS 11.x.

## Error Response Structure

All errors follow a consistent structure. HTTP status code carries semantic meaning.

```json
{
  "error": {
    "code": "segment_rule_invalid",
    "message": "Segment rule references undefined attribute 'plan_tier'.",
    "param": "segment.rules[0].attribute",
    "requestId": "req_abc123",
    "correlationId": "corr_xyz789"
  }
}
```

### Error Codes by HTTP Status

| HTTP Status | Error Codes |
|-------------|-------------|
| 400 | `invalid_request`, `validation_failed`, `invalid_parameter`, `missing_required_field`, `invalid_format` |
| 401 | `authentication_error`, `invalid_api_key`, `expired_token`, `missing_authorization` |
| 403 | `authorization_error`, `insufficient_permissions`, `tenant_access_denied`, `resource_access_denied` |
| 404 | `not_found`, `resource_not_found`, `endpoint_not_found` |
| 409 | `conflict`, `duplicate_resource`, `state_conflict`, `idempotency_key_collision`, `foreign_key_violation` |
| 429 | `rate_limit_exceeded` |
| 500 | `internal_error`, `unexpected_error`, `database_error` |
| 503 | `service_unavailable`, `circuit_breaker_open` |

### X-Request-Id Header

The `requestId` is present on every response (success or error) and returned as the `X-Request-Id` response header. Include in support requests.

### Correlation ID

The `correlationId` enables distributed tracing across services. Both `requestId` and `correlationId` are sourced from AsyncLocalStorage (ALS) context set by `AlsAuthInterceptor`.

### Validation Errors with Details

For 400 validation errors, include a `details` array with per-field diagnostics:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Validation failed",
    "requestId": "req_abc123",
    "details": [
      { "field": "email", "message": "email must be a valid email" },
      { "field": "name", "message": "name must not be empty" }
    ]
  }
}
```

## Exception Hierarchy

### Base Exception

```typescript
// src/common/exceptions/base.exceptions.ts
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@app/types';

export class BaseException extends HttpException {
    constructor(
        public readonly code: ErrorCode,
        message: string,
        status: HttpStatus,
        public readonly param?: string,
        public readonly details?: Record<string, unknown>
    ) {
        super({ code, message, param, details }, status);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
```

### Concrete Exceptions

```typescript
// src/common/exceptions/validation.exceptions.ts
import { HttpStatus } from '@nestjs/common';
import type { IValidationErrorDetail } from '@app/types';
import { BaseException } from './base.exceptions';

export class ValidationException extends BaseException {
    constructor(message: string, errors: IValidationErrorDetail[] = [], param?: string) {
        super('validation_failed', message, HttpStatus.BAD_REQUEST, param, { errors });
    }
}

// src/common/exceptions/not-found.exceptions.ts
export class NotFoundException extends BaseException {
    constructor(resource: string, identifier: string | number) {
        super('resource_not_found', `${resource} with ID ${identifier} not found`, HttpStatus.NOT_FOUND, resource, {
            resource,
            identifier
        });
    }
}

// src/common/exceptions/business.exceptions.ts
import type { ErrorCode } from '@app/types';

export class BusinessException extends BaseException {
    constructor(code: ErrorCode, message: string, param?: string, details?: Record<string, unknown>) {
        super(code, message, HttpStatus.UNPROCESSABLE_ENTITY, param, details);
    }
}

// src/common/exceptions/database.exceptions.ts
export class DatabaseException extends BaseException {
    constructor(message: string, cause?: Error) {
        super('database_error', message, HttpStatus.SERVICE_UNAVAILABLE, undefined, { cause: cause?.message });
    }
}

// src/common/exceptions/messaging.exceptions.ts
export class MessagingException extends BaseException {
    constructor(code: ErrorCode, message: string, messageId?: string, queueName?: string, details?: Record<string, unknown>) {
        super(code, message, HttpStatus.INTERNAL_SERVER_ERROR, undefined, { ...details, messageId, queueName });
    }
}

export class MessageParseException extends BaseException {
    constructor(message: string, details?: Record<string, unknown>) {
        super('invalid_request', message, HttpStatus.BAD_REQUEST, undefined, details);
    }
}
```

## Global Exception Filter

Creates standardized error responses for all errors.

```typescript
// src/common/exceptions/global-exceptions.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
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
    ) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        const response = ctx.getResponse<Response>();

        const requestId = this.tenantContext.getRequestId() ?? 'unknown';

        let status: HttpStatus;
        let apiError: IApiError;

        if (exception instanceof BaseException) {
            ({ status, apiError } = this.handleBaseException(exception, requestId));
        } else if (exception instanceof PrismaClientKnownRequestError) {
            ({ status, apiError } = this.handlePrismaError(exception, requestId));
        } else if (exception instanceof HttpException) {
            ({ status, apiError } = this.handleHttpException(exception, requestId));
        } else {
            ({ status, apiError } = this.handleUnknownError(requestId));
        }

        const errorResponse: IErrorResponse = { error: apiError };

        // Send response with X-Request-Id header
        response.setHeader('X-Request-Id', requestId).status(status).json(errorResponse);
    }
}
```

### Prisma Error Mapping

| Prisma Code | HTTP Status | Error Code |
|-------------|-------------|------------|
| P2002 | 409 | `duplicate_resource` |
| P2025 | 404 | `resource_not_found` |
| P2003 | 400 | `foreign_key_violation` |
| Other | 500 | `database_error` |

## Usage Examples

### Throwing Exceptions

```typescript
import { NotFoundException, ValidationException, BusinessException } from '@common/exceptions';

// Not found
throw new NotFoundException('Campaign', 'camp_abc123');
// → { "error": { "code": "resource_not_found", "message": "Campaign with ID camp_abc123 not found", ... } }

// Validation error
throw new ValidationException('Validation failed', [
    { field: 'email', message: 'email must be a valid email' },
    { field: 'name', message: 'name must not be empty' }
]);

// Business logic error
throw new BusinessException('state_conflict', 'Cannot activate an already active campaign', 'status');

// Messaging error (SQS/SNS)
throw new MessagingException('internal_error', 'Failed to process message', envelope.messageId, 'my-queue');
```

### Adding New Error Codes

Add to `ErrorCode` type in `src/types/app.type.ts`:

```typescript
export type ErrorCode =
    // ... existing codes
    | 'my_new_error_code';
```

## Validation Pipe Configuration

Global validation with class-validator and class-transformer.

```typescript
// src/app.module.ts (excerpt)
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

@Module({
    providers: [
        {
            provide: APP_PIPE,
            useFactory: (configService: ConfigService) => {
                const environment = configService.get<string>('app.environment');
                return new ValidationPipe({
                    whitelist: true,
                    forbidNonWhitelisted: true,
                    transform: true,
                    transformOptions: {
                        enableImplicitConversion: true
                    },
                    disableErrorMessages: environment === 'production',
                    forbidUnknownValues: true,
                    validationError: {
                        target: false,
                        value: false
                    }
                });
            },
            inject: [ConfigService]
        }
    ]
})
export class AppModule {}
```

## API Versioning

URI-based versioning for backward compatibility.

```typescript
// src/main.ts (excerpt)
import { VersioningType } from '@nestjs/common';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: '1',
        prefix: 'v'
    });

    await app.listen(3000);
}
```

### Using Versioning in Controllers

```typescript
@Controller({ path: 'users', version: '1' })
@ApiTags('users')
export class UsersControllerV1 {
    @Get()
    findAll() {
        return { message: 'Users v1' };
    }
}

@Controller({ path: 'users', version: '2' })
@ApiTags('users')
export class UsersControllerV2 {
    @Get()
    findAll() {
        return { message: 'Users v2 with enhanced response' };
    }
}
```

URLs:
- `/v1/users` - Version 1
- `/v2/users` - Version 2