import { HttpStatus } from '@nestjs/common';

import type { IValidationErrorDetail } from '@app/types';

import { BaseException } from './base.exceptions';

/**
 * Validation exception for input validation failures.
 * HTTP Status: 400 Bad Request
 */
export class ValidationException extends BaseException {
    constructor(message: string, errors: IValidationErrorDetail[] = [], param?: string) {
        super('validation_failed', message, HttpStatus.BAD_REQUEST, param, { errors });
    }
}
