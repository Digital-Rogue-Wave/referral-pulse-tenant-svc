import { Injectable, OnModuleInit, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import type { AllConfigType } from '@app/config/config.type';
import type { IS3UploadOptions, IPresignedUrlOptions, IS3UploadResult, IS3ObjectMetadata } from '@app/types';
import { Environment } from '@app/types';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { DateService } from '@app/common/helper/date.service';

@Injectable()
export class S3Service implements OnModuleInit {
    private client: S3Client;
    private readonly bucketName: string;
    private readonly presignedUrlExpiry: number;
    private readonly uploadPartSize: number;
    private readonly maxConcurrentUploads: number;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: ClsTenantContextService,
        private readonly tracingService: TracingService,
        private readonly dateService: DateService,
    ) {
        this.bucketName = this.configService.getOrThrow('aws.s3.bucketName', { infer: true });
        this.presignedUrlExpiry = this.configService.getOrThrow('aws.s3.presignedUrlExpiry', { infer: true });
        this.uploadPartSize = this.configService.getOrThrow('aws.s3.uploadPartSize', { infer: true });
        this.maxConcurrentUploads = this.configService.getOrThrow('aws.s3.maxConcurrentUploads', { infer: true });
    }

    async onModuleInit(): Promise<void> {
        const nodeEnv = this.configService.getOrThrow('app.nodeEnv', { infer: true });
        const region = this.configService.getOrThrow('aws.region', { infer: true });
        const endpoint = this.configService.get('aws.endpoint', { infer: true });

        // Use credentials only in development/test (LocalStack)
        const useCredentials = nodeEnv === Environment.Development || nodeEnv === Environment.Test;
        const credentials = useCredentials
            ? {
                  accessKeyId: this.configService.getOrThrow('aws.accessKeyId', { infer: true }),
                  secretAccessKey: this.configService.getOrThrow('aws.secretAccessKey', { infer: true }),
              }
            : undefined;

        this.client = new S3Client({
            region,
            endpoint: endpoint || undefined,
            credentials,
            forcePathStyle: !!endpoint,
        });
    }

    private buildKey(key: string): string {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) throw new Error('Tenant context required for S3 operations');
        return `tenants/${tenantId}/${key}`;
    }

    async upload(key: string, body: Buffer | Readable | string, options?: IS3UploadOptions): Promise<IS3UploadResult> {
        return this.tracingService.withSpan('s3.upload', async () => {
            const fullKey = this.buildKey(key);
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: fullKey,
                Body: body,
                ContentType: options?.contentType,
                Metadata: options?.metadata,
                ACL: options?.acl,
                ServerSideEncryption: options?.serverSideEncryption,
                CacheControl: options?.cacheControl,
            });
            const result = await this.client.send(command);
            return {
                key: fullKey,
                bucket: this.bucketName,
                location: `s3://${this.bucketName}/${fullKey}`,
                etag: result.ETag?.replace(/"/g, '') || '',
                versionId: result.VersionId,
            };
        });
    }

    async uploadMultipart(key: string, body: Readable | Buffer, options?: IS3UploadOptions): Promise<IS3UploadResult> {
        return this.tracingService.withSpan('s3.uploadMultipart', async () => {
            const fullKey = this.buildKey(key);
            const upload = new Upload({
                client: this.client,
                params: {
                    Bucket: this.bucketName,
                    Key: fullKey,
                    Body: body,
                    ContentType: options?.contentType,
                    Metadata: options?.metadata,
                    ACL: options?.acl,
                    ServerSideEncryption: options?.serverSideEncryption,
                },
                queueSize: this.maxConcurrentUploads,
                partSize: this.uploadPartSize,
            });
            const result = await upload.done();
            return {
                key: fullKey,
                bucket: this.bucketName,
                location: result.Location || `s3://${this.bucketName}/${fullKey}`,
                etag: result.ETag?.replace(/"/g, '') || '',
                versionId: result.VersionId,
            };
        });
    }

    async download(key: string): Promise<Readable> {
        const fullKey = this.buildKey(key);
        const command = new GetObjectCommand({ Bucket: this.bucketName, Key: fullKey });
        const result = await this.client.send(command);
        return result.Body as Readable;
    }

    async downloadAsBuffer(key: string): Promise<Buffer> {
        const stream = await this.download(key);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }

    async delete(key: string): Promise<void> {
        const fullKey = this.buildKey(key);
        const command = new DeleteObjectCommand({ Bucket: this.bucketName, Key: fullKey });
        await this.client.send(command);
    }

    async exists(key: string): Promise<boolean> {
        try {
            await this.getMetadata(key);
            return true;
        } catch {
            return false;
        }
    }

    async getMetadata(key: string): Promise<IS3ObjectMetadata> {
        const fullKey = this.buildKey(key);
        const command = new HeadObjectCommand({ Bucket: this.bucketName, Key: fullKey });
        const result = await this.client.send(command);
        return {
            key: fullKey,
            size: result.ContentLength || 0,
            lastModified: result.LastModified || this.dateService.nowMoment().toDate(),
            contentType: result.ContentType,
            etag: result.ETag?.replace(/"/g, '') || '',
            metadata: result.Metadata,
        };
    }

    async list(prefix: string, maxKeys = 1000): Promise<IS3ObjectMetadata[]> {
        const fullPrefix = this.buildKey(prefix);
        const command = new ListObjectsV2Command({ Bucket: this.bucketName, Prefix: fullPrefix, MaxKeys: maxKeys });
        const result = await this.client.send(command);
        return (result.Contents || []).map((obj) => ({
            key: obj.Key || '',
            size: obj.Size || 0,
            lastModified: obj.LastModified || this.dateService.nowMoment().toDate(),
            etag: obj.ETag?.replace(/"/g, '') || '',
        }));
    }

    async getPresignedDownloadUrl(key: string, options?: IPresignedUrlOptions): Promise<string> {
        const fullKey = this.buildKey(key);
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: fullKey,
            ResponseContentDisposition: options?.contentDisposition,
            ResponseContentType: options?.contentType,
        });
        return getSignedUrl(this.client, command, { expiresIn: options?.expiresIn || this.presignedUrlExpiry });
    }

    async getPresignedUploadUrl(key: string, options?: IPresignedUrlOptions): Promise<string> {
        const fullKey = this.buildKey(key);
        const command = new PutObjectCommand({ Bucket: this.bucketName, Key: fullKey, ContentType: options?.contentType });
        return getSignedUrl(this.client, command, { expiresIn: options?.expiresIn || this.presignedUrlExpiry });
    }

    getClient(): S3Client {
        return this.client;
    }

    getBucketName(): string {
        return this.bucketName;
    }
}
