import { Readable } from 'node:stream';
import { S3SseMode } from '@mod/config/s3.config';
import { MessageAttributeValue } from '@aws-sdk/client-sqs';
import { EntityTarget, ObjectLiteral } from 'typeorm';
import { ConfigType } from '@nestjs/config';
import sqsConfig from '@mod/config/sqs.config';
import CircuitBreaker from 'opossum';
import { MaybeType } from '@mod/types/maybe.type';

export type JsonRecord = Record<string, unknown>;
export type ProducerDef = ConfigType<typeof sqsConfig>['producers'][number];

export type PutObjectInput = {
    key: string;
    body: Buffer | Uint8Array | Blob | string | Readable;
    contentType?: string;
    cacheControl?: string;
    contentEncoding?: string;
    metadata?: Record<string, string>;
    /** Explicitly set SSE mode; defaults from config */
    sseMode?: S3SseMode;
    /** KMS key ID if sseMode='aws:kms' (overrides config.kmsKeyId) */
    kmsKeyId?: string;
};

export type GetObjectResult = {
    stream: Readable;
    contentLength?: number;
    contentType?: string;
    etag?: string;
    metadata?: Record<string, string>;
    lastModified?: Date;
};

export type ListResult = {
    keys: string[];
    nextContinuationToken?: string;
};

export type PresignGetOptions = {
    key: string;
    expiresInSeconds?: number; // default from config
    responseContentType?: string;
    responseContentDisposition?: string;
};

export type PresignPutOptions = {
    key: string;
    expiresInSeconds?: number; // default from config
    contentType?: string;
    contentLength?: number;
};

export type LogContext = {
    tenantId?: MaybeType<string>;
    userId?: MaybeType<string>;
    requestId?: MaybeType<string>;
    traceId?: MaybeType<string>;
    spanId?: MaybeType<string>;
    albTraceRoot?: MaybeType<string>;
    albParentId?: MaybeType<string>;
    albSampled?: MaybeType<boolean>;
};

export type ErrorFields = {
    errName?: string;
    errMessage?: string;
    stack?: string;
};

export type HttpStartMeta = {
    method: string;
    url: string;
    ip?: string;
    userAgent?: string;
    contentLength?: string | number;
};

export type HttpEndMeta = HttpStartMeta & {
    statusCode: number;
    durationMs: number;
    responseSize?: number;
};

export type PublishOptions = {
    topic: string; // logical topic name (must exist in config)
    subject?: string;
    groupId?: string; // FIFO only
    deduplicationId?: string; // FIFO only
    attributes?: Record<string, string>; // MessageAttributes as string map (will add tenantId)
};

export type SendOptions = {
    producer: string;
    groupId?: string; // FIFO
    deduplicationId?: string; // FIFO
    attributes?: Record<string, MessageAttributeValue>;
    delaySeconds?: number;
};

export type BatchItem<T extends Json> = {
    payload: T;
    options?: Omit<SendOptions, 'producer'>; // producer passed separately
};

export type BrokerTokenResponse = { access_token: string; expires_in: number; token_type: 'Bearer' };

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type Attrs = Record<string, MessageAttributeValue>;

export type ValidationEntity = { id?: number | string } | undefined;

export type RpcTransport = 'rmq' | 'kafka' | 'nats' | 'redis' | 'mqtt' | 'grpc' | 'tcp' | 'unknown';

export type ExistsConstraintTuple<E extends ObjectLiteral> = [entity: EntityTarget<E>, pathToProperty?: string];

export type ExecFn<T = unknown> = () => Promise<T>;
export type Breaker<T = unknown> = CircuitBreaker<[ExecFn<T>], T>;
