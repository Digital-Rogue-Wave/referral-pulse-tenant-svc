import { HttpStatus } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';

export class DatabaseException extends BaseException {
    constructor(message: string, cause?: Error) {
        super('DATABASE_ERROR', message, HttpStatus.SERVICE_UNAVAILABLE, {
            cause: cause?.message,
        });
    }
}
