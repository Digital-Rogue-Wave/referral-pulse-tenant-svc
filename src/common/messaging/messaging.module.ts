import { Global, Module, DynamicModule } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { SqsModule } from '@ssut/nestjs-sqs';
import type { AllConfigType } from '@app/config/config.type';
import { Environment } from '@app/types';
import { SqsProducerService } from './sqs-producer.service';
import { SnsPublisherService } from './sns-publisher.service';
import { MessageEnvelopeService } from './message-envelope.service';
import { DlqConsumerService } from './dlq-consumer.service';
import { MessageProcessorService } from './message-processor.service';
import { IdempotencyModule } from '@app/common/idempotency';

@Global()
@Module({})
export class MessagingModule {
    static forRoot(): DynamicModule {
        return {
            module: MessagingModule,
            imports: [
                IdempotencyModule,
                SqsModule.registerAsync({
                    imports: [ConfigModule],
                    inject: [ConfigService],
                    useFactory: (configService: ConfigService<AllConfigType>) => {
                        const nodeEnv = configService.getOrThrow('app.nodeEnv', { infer: true });
                        const region = configService.getOrThrow('aws.region', { infer: true });
                        const endpoint = configService.get('aws.endpoint', { infer: true });
                        const queues = configService.getOrThrow('aws.sqs.queues', { infer: true });
                        const defaultBatchSize = configService.getOrThrow('aws.sqs.defaultBatchSize', { infer: true });
                        const defaultVisibilityTimeout = configService.getOrThrow('aws.sqs.defaultVisibilityTimeout', { infer: true });
                        const defaultWaitTimeSeconds = configService.getOrThrow('aws.sqs.defaultWaitTimeSeconds', { infer: true });
                        const pollingEnabled = configService.getOrThrow('aws.sqs.pollingEnabled', { infer: true });

                        const useCredentials = nodeEnv === Environment.Development || nodeEnv === Environment.Test;
                        const credentials = useCredentials
                            ? {
                                  accessKeyId: configService.getOrThrow('aws.accessKeyId', { infer: true }),
                                  secretAccessKey: configService.getOrThrow('aws.secretAccessKey', { infer: true }),
                              }
                            : undefined;

                        const consumers = pollingEnabled
                            ? queues.map((queue) => ({
                                  name: queue.name,
                                  queueUrl: queue.url,
                                  region,
                                  batchSize: defaultBatchSize,
                                  visibilityTimeout: defaultVisibilityTimeout,
                                  waitTimeSeconds: defaultWaitTimeSeconds,
                                  terminateVisibilityTimeout: true,
                                  ...(endpoint && { endpoint }),
                                  ...(credentials && { credentials }),
                              }))
                            : [];

                        const producers = queues.map((queue) => ({
                            name: queue.name,
                            queueUrl: queue.url,
                            region,
                            ...(endpoint && { endpoint }),
                            ...(credentials && { credentials }),
                        }));

                        return { consumers, producers };
                    },
                }),
            ],
            providers: [
                SqsProducerService,
                SnsPublisherService,
                MessageEnvelopeService,
                DlqConsumerService,
                MessageProcessorService,
            ],
            exports: [
                SqsModule,
                SqsProducerService,
                SnsPublisherService,
                MessageEnvelopeService,
                DlqConsumerService,
                MessageProcessorService,
            ],
        };
    }
}