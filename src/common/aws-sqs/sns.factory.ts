import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient, SNSClientConfig } from '@aws-sdk/client-sns';
import { NodeHttpHandler } from '@smithy/node-http-handler';

@Injectable()
export class SnsFactory {
    private readonly client: SNSClient;

    constructor(private readonly configService: ConfigService) {
        const cfg: SNSClientConfig = {
            region: this.configService.getOrThrow<string>('awsConfig.region', { infer: true }),
            maxAttempts: this.configService.get<number>('awsConfig.maxAttempts', { infer: true }) ?? 3,
            retryMode:
                this.configService.get<'standard' | 'adaptive' | 'legacy'>('awsConfig.retryMode', {
                    infer: true
                }) ?? 'standard',
            requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 60000 })
        };

        this.client = new SNSClient(cfg);
    }

    getClient(): SNSClient {
        return this.client;
    }
}
