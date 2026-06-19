import { HttpStatus } from '@nestjs/common';

import type { ErrorCode } from '@app/types';

import { BaseException } from './base.exceptions';

/**
 * Business exception for business logic violations.
 * HTTP Status: 422 Unprocessable Entity
 */
export class BusinessException extends BaseException {
    constructor(code: ErrorCode, message: string, param?: string, details?: Record<string, unknown>) {
        super(code, message, HttpStatus.UNPROCESSABLE_ENTITY, param, details);
    }
}
