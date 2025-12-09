import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';

@Injectable()
export class S3Factory {
    private readonly client: S3Client;

    constructor(private readonly configService: ConfigService) {
        // ---- shared AWS settings
        const region = this.configService.getOrThrow<string>('awsConfig.region', { infer: true });
        const maxAttempts =
            this.configService.get<number>('awsConfig.maxAttempts', { infer: true }) ?? 3;
        const retryMode =
            this.configService.get<'standard' | 'adaptive' | 'legacy'>('awsConfig.retryMode', {
                infer: true,
            }) ?? 'standard';

        // ---- S3-specific settings
        const endpoint = this.configService.get<string>('s3Config.endpoint', { infer: true });
        const forcePathStyle =
            this.configService.get<boolean>('s3Config.forcePathStyle', { infer: true }) ?? false;
        const accelerate =
            this.configService.get<boolean>('s3Config.accelerate', { infer: true }) ?? false;

        const base: S3ClientConfig = {
            region,
            maxAttempts,
            retryMode,
            requestHandler: new NodeHttpHandler({
                connectionTimeout: 5_000,
                requestTimeout: 60_000,
            }),
        };

        // Custom endpoint (e.g., LocalStack/MinIO) and Accelerate are mutually exclusive.
        if (endpoint) {
            base.endpoint = endpoint;
            base.forcePathStyle = forcePathStyle;
        } else if (accelerate) {
            base.useAccelerateEndpoint = true;
        }

        this.client = new S3Client(base);
    }

    getClient(): S3Client {
        return this.client;
    }
}
