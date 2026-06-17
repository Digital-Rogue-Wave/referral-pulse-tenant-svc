import { HttpStatus } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';

export class ValidationException extends BaseException {
    constructor(message: string, errors: string[] = [], details?: Record<string, unknown>) {
        super('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST, {
            ...details,
            errors
        });
    }
}
