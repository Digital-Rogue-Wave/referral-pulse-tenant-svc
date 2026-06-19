import { HttpException, HttpStatus } from '@nestjs/common';

import type { ErrorCode } from '@app/types';

/**
 * Base exception for all application errors.
 * Follows the standardized error model with code, message, and optional param/details.
 */
export class BaseException extends HttpException {
    constructor(
        /** Error code (e.g., 'validation_failed', 'resource_not_found') */
        public readonly code: ErrorCode,
        /** Human-readable error message */
        message: string,
        /** HTTP status code */
        status: HttpStatus,
        /** Parameter/field that caused the error (for validation errors) */
        public readonly param?: string,
        /** Additional details (e.g., validation error array) */
        public readonly details?: Record<string, unknown>
    ) {
        super({ code, message, param, details }, status);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * Get the error code
     */
    getCode(): ErrorCode {
        return this.code;
    }

    /**
     * Get the param that caused the error
     */
    getParam(): string | undefined {
        return this.param;
    }

    /**
     * Get additional details
     */
    getDetails(): Record<string, unknown> | undefined {
        return this.details;
    }
}
