import { HttpStatus } from '@nestjs/common';

import { BaseException } from './base.exceptions';

export class BusinessException extends BaseException {
    constructor(errorCode: string, message: string, details?: Record<string, unknown>) {
        super(errorCode, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
    }
}
