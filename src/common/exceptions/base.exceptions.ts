import { HttpException, HttpStatus } from '@nestjs/common';

export class BaseException extends HttpException {
    constructor(
        public readonly errorCode: string,
        message: string,
        status: HttpStatus,
        public readonly details?: Record<string, unknown>,
    ) {
        super({ errorCode, message, details }, status);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
