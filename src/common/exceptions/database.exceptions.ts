import { HttpStatus } from '@nestjs/common';

import { BaseException } from './base.exceptions';

/**
 * Database exception for database operation failures.
 * HTTP Status: 503 Service Unavailable
 */
export class DatabaseException extends BaseException {
    constructor(message: string, cause?: Error) {
        super('database_error', message, HttpStatus.SERVICE_UNAVAILABLE, undefined, { cause: cause?.message });
    }
}
