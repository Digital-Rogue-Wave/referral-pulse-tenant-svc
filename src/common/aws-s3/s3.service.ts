import { Injectable } from '@nestjs/common';
import {
    CompleteMultipartUploadCommandOutput,
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
    ServerSideEncryption
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { S3SseMode } from '@mod/config/s3.config';
import { S3Factory } from './s3.factory';
import { S3KeyBuilder } from './s3-key.builder';
import { GetObjectResult, ListResult, PresignGetOptions, PresignPutOptions, PutObjectInput } from '@mod/types/app.type';

@Injectable()
export class S3Service {
    private readonly s3: S3Client;
    private readonly bucket: string;
    private readonly defaultSseMode: S3SseMode;
    private readonly defaultKmsKeyId?: string;
    private readonly presignExpiresSeconds: number;

    constructor(
        factory: S3Factory,
        private readonly configService: ConfigService,
        private readonly keys: S3KeyBuilder
    ) {
        this.s3 = factory.getClient();

        this.bucket = this.configService.getOrThrow<string>('s3Config.bucket', { infer: true });

        // If your config returns a string, normalize to the enum here
        const rawSse = this.configService.getOrThrow<string>('s3Config.sse', { infer: true });
        this.defaultSseMode = this.normalizeSseMode(rawSse);

        this.defaultKmsKeyId = this.configService.get<string>('s3Config.kmsKeyId', { infer: true }) ?? undefined;

        this.presignExpiresSeconds = this.configService.getOrThrow<number>('s3Config.presignExpiresSeconds', { infer: true });
    }

    // ----------------- Put (small/medium)
    async putObject(input: PutObjectInput): Promise<string /* ETag */> {
        const Key = this.keys.build(input.key);
        const sse = this.resolveSse(input.sseMode, input.kmsKeyId);

        const cmd = new PutObjectCommand({
            Bucket: this.bucket,
            Key,
            Body: input.body,
            ContentType: input.contentType,
            CacheControl: input.cacheControl,
            ContentEncoding: input.contentEncoding,
            Metadata: input.metadata,
            ServerSideEncryption: sse.sseAlg,
            SSEKMSKeyId: sse.kmsKeyId
        });
        const out = await this.s3.send(cmd);
        return out.ETag ?? '';
    }

    // ----------------- Put large (stream/multipart via lib-storage)
    async uploadLarge(input: PutObjectInput): Promise<CompleteMultipartUploadCommandOutput> {
        const Key = this.keys.build(input.key);
        const sse = this.resolveSse(input.sseMode, input.kmsKeyId);

        const uploader = new Upload({
            client: this.s3,
            params: {
                Bucket: this.bucket,
                Key,
                Body: input.body,
                ContentType: input.contentType,
                CacheControl: input.cacheControl,
                ContentEncoding: input.contentEncoding,
                Metadata: input.metadata,
                ServerSideEncryption: sse.sseAlg,
                SSEKMSKeyId: sse.kmsKeyId
            },
            queueSize: 4,
            partSize: 8 * 1024 * 1024, // 8MB parts
            leavePartsOnError: false
        });

        return uploader.done();
    }

    // ----------------- Get (stream)
    async getObjectStream(key: string): Promise<GetObjectResult> {
        const Key = this.keys.build(key);
        const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
        const stream = out.Body as Readable;
        return {
            stream,
            contentLength: out.ContentLength ?? undefined,
            contentType: out.ContentType ?? undefined,
            etag: out.ETag ?? undefined,
            metadata: (out.Metadata ?? undefined) as Record<string, string> | undefined,
            lastModified: out.LastModified ?? undefined
        };
    }

    // ----------------- Head
    async headObject(key: string): Promise<{
        exists: boolean;
        size?: number;
        contentType?: string;
        lastModified?: Date;
        etag?: string;
        metadata?: Record<string, string>;
    }> {
        const Key = this.keys.build(key);
        try {
            const out = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
            return {
                exists: true,
                size: out.ContentLength ?? undefined,
                contentType: out.ContentType ?? undefined,
                lastModified: out.LastModified ?? undefined,
                etag: out.ETag ?? undefined,
                metadata: (out.Metadata ?? undefined) as Record<string, string> | undefined
            };
        } catch {
            return { exists: false };
        }
    }

    // ----------------- Delete
    async deleteObject(key: string): Promise<void> {
        const Key = this.keys.build(key);
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key }));
    }

    // ----------------- List
    async list(prefix: string, maxKeys = 1000, continuationToken?: string): Promise<ListResult> {
        const Prefix = this.keys.build(prefix).replace(/\/+$/, '') + '/';
        const out = await this.s3.send(
            new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix,
                MaxKeys: maxKeys,
                ContinuationToken: continuationToken
            })
        );
        return {
            keys: (out.Contents ?? []).map((o) => o.Key as string),
            nextContinuationToken: out.IsTruncated ? out.NextContinuationToken : undefined
        };
    }

    // ----------------- Copy / Move
    async copyObject(srcKey: string, destKey: string): Promise<string /* ETag */> {
        const Source = `/${this.bucket}/${this.keys.build(srcKey)}`; // CopySource format
        const DestinationKey = this.keys.build(destKey);
        const sse = this.resolveSse(undefined, undefined);
        const out = await this.s3.send(
            new CopyObjectCommand({
                Bucket: this.bucket,
                Key: DestinationKey,
                CopySource: Source,
                ServerSideEncryption: sse.sseAlg,
                SSEKMSKeyId: sse.kmsKeyId,
                MetadataDirective: 'COPY' // keep original metadata
            })
        );
        return out.CopyObjectResult?.ETag ?? '';
    }

    async moveObject(srcKey: string, destKey: string): Promise<void> {
        await this.copyObject(srcKey, destKey);
        await this.deleteObject(srcKey);
    }

    // ----------------- Presigned URLs
    async presignGet(opts: PresignGetOptions): Promise<string> {
        const Key = this.keys.build(opts.key);
        const expires = opts.expiresInSeconds ?? this.presignExpiresSeconds;
        const cmd = new GetObjectCommand({
            Bucket: this.bucket,
            Key,
            ResponseContentType: opts.responseContentType,
            ResponseContentDisposition: opts.responseContentDisposition
        });
        return getSignedUrl(this.s3, cmd, { expiresIn: expires });
    }

    async presignPut(opts: PresignPutOptions): Promise<string> {
        const Key = this.keys.build(opts.key);
        const expires = opts.expiresInSeconds ?? this.presignExpiresSeconds;
        const sse = this.resolveSse(undefined, undefined);
        const cmd = new PutObjectCommand({
            Bucket: this.bucket,
            Key,
            ContentType: opts.contentType,
            ContentLength: opts.contentLength,
            ServerSideEncryption: sse.sseAlg,
            SSEKMSKeyId: sse.kmsKeyId
        });
        return getSignedUrl(this.s3, cmd, { expiresIn: expires });
    }

    // ----------------- Helpers

    private normalizeSseMode(value: string | S3SseMode): S3SseMode {
        if (typeof value !== 'string') return value;
        const v = value.trim();
        if (v === 'none') return S3SseMode.None;
        if (v === 'AES256') return S3SseMode.AES256;
        if (v === 'aws:kms') return S3SseMode.Kms;
        throw new Error(`Invalid s3Config.sse value: "${value}"`);
    }

    private resolveSse(sseMode?: S3SseMode, kmsKeyId?: string): { sseAlg?: ServerSideEncryption; kmsKeyId?: string } {
        const mode = sseMode ?? this.defaultSseMode;
        if (mode === S3SseMode.None) return {};
        if (mode === S3SseMode.AES256) return { sseAlg: 'AES256' };
        // aws:kms
        return { sseAlg: 'aws:kms', kmsKeyId: kmsKeyId ?? this.defaultKmsKeyId };
    }
}
