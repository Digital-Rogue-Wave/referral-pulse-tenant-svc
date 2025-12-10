import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService, ConfigType } from '@nestjs/config';
import { SqsModule as SsutSqsModule } from '@ssut/nestjs-sqs';
import type { SQSClientConfig } from '@aws-sdk/client-sqs';
import sqsConfig from '@mod/config/sqs.config';
import awsConfig from '@mod/config/aws.config';
import { SqsManager } from './sqs.manager';

type SqsCfg = ConfigType<typeof sqsConfig>;
type SqsConsumerDef = SqsCfg['consumers'][number];
type SqsProducerDef = SqsCfg['producers'][number];

@Global()
@Module({})
export class SqsMessagingModule {
    static register(): DynamicModule {
        return {
            module: SqsMessagingModule,
            imports: [
                ConfigModule.forFeature(sqsConfig),
                ConfigModule.forFeature(awsConfig),
                SsutSqsModule.registerAsync({
                    imports: [ConfigModule.forFeature(sqsConfig), ConfigModule.forFeature(awsConfig)],
                    inject: [ConfigService],
                    useFactory: (cfg: ConfigService) => {
                        // Load full typed configs
                        const aws = cfg.getOrThrow<ConfigType<typeof awsConfig>>('awsConfig', { infer: true });
                        const sqs = cfg.getOrThrow<SqsCfg>('sqsConfig', { infer: true });

                        const sqsClientConfig: SQSClientConfig = {
                            region: aws.region,
                            endpoint: sqs.endpoint || undefined,
                            maxAttempts: aws.maxAttempts,
                            retryMode: aws.retryMode // 'standard' | 'adaptive' | 'legacy'
                        };

                        const consumers: ReadonlyArray<SqsConsumerDef> = sqs.consumers ?? [];
                        const producers: ReadonlyArray<SqsProducerDef> = sqs.producers ?? [];

                        return {
                            consumers: consumers.map((consumer: SqsConsumerDef) => ({
                                name: consumer.name,
                                queueUrl: consumer.queueUrl,
                                waitTimeSeconds: consumer.waitTimeSeconds,
                                visibilityTimeout: consumer.visibilityTimeout,
                                maxNumberOfMessages: consumer.batchSize
                            })),
                            producers: producers.map((producer: SqsProducerDef) => ({
                                name: producer.name,
                                queueUrl: producer.queueUrl
                            })),
                            sqs: sqsClientConfig
                        };
                    }
                })
            ],
            providers: [SqsManager],
            exports: [SqsManager, SsutSqsModule]
        };
    }
}
