import { HttpStatus } from '@nestjs/common';

import type { ErrorCode } from '@app/types';

import { BaseException } from './base.exceptions';

/**
 * Messaging exception for SQS/SNS message processing failures.
 * Used for errors that occur during message handling.
 */
export class MessagingException extends BaseException {
    constructor(
        code: ErrorCode,
        message: string,
        public readonly messageId?: string,
        public readonly queueName?: string,
        details?: Record<string, unknown>
    ) {
        super(code, message, HttpStatus.INTERNAL_SERVER_ERROR, undefined, {
            ...details,
            messageId,
            queueName
        });
    }
}

/**
 * Message parsing exception for invalid message format.
 */
export class MessageParseException extends BaseException {
    constructor(message: string, details?: Record<string, unknown>) {
        super('invalid_request', message, HttpStatus.BAD_REQUEST, undefined, details);
    }
}

/**
 * Message validation exception for invalid message payload.
 */
export class MessageValidationException extends BaseException {
    constructor(message: string, details?: Record<string, unknown>) {
        super('validation_failed', message, HttpStatus.BAD_REQUEST, undefined, details);
    }
}
