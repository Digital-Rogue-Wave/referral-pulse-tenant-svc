import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENCY_KEY = 'idempotency';

export interface IdempotencyOptions {
    ttl?: number; // seconds
    keyPrefix?: string;
}

export const Idempotent = (options: IdempotencyOptions = {}) => SetMetadata(IDEMPOTENCY_KEY, options);
