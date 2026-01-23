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
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { S3Service } from '@common/storage/s3.service';
import { S3KeyBuilder } from './s3-key.builder';

@Global()
@Module({
    providers: [S3Service, S3KeyBuilder],
    exports: [S3Service, S3KeyBuilder],
})
export class StorageModule {}
