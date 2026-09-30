import { Module, DynamicModule } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';

import { SqsModule } from '@ssut/nestjs-sqs';

import { Environment } from '@app/types';

import type { AllConfigType } from '@config/config.type';

import { MessageEnvelopeService } from './message-envelope.service';
import { SnsPublisherService } from './sns-publisher.service';
import { SqsProducerService } from './sqs-producer.service';

@Module({})
export class MessagingModule {
    static forRoot(): DynamicModule {
        return {
            module: MessagingModule,
            imports: [
                SqsModule.registerAsync({
                    imports: [ConfigModule],
                    inject: [ConfigService],
                    useFactory: (configService: ConfigService<AllConfigType>) => {
                        const nodeEnv = configService.getOrThrow('app.nodeEnv', {
                            infer: true
                        });
                        const region = configService.getOrThrow('aws.region', {
                            infer: true
                        });
                        const endpoint = configService.get('aws.endpoint', { infer: true });
                        const queues = configService.getOrThrow('aws.sqs.queues', {
                            infer: true
                        });
                        const useCredentials = nodeEnv === Environment.Development || nodeEnv === Environment.Test;
                        const credentials = useCredentials
                            ? {
                                  accessKeyId: configService.getOrThrow('aws.accessKeyId', {
                                      infer: true
                                  }),
                                  secretAccessKey: configService.getOrThrow('aws.secretAccessKey', { infer: true })
                              }
                            : undefined;

                        const producers = queues.map((queue) => ({
                            name: queue.name,
                            queueUrl: queue.url,
                            region,
                            ...(endpoint && { endpoint }),
                            ...(credentials && { credentials })
                        }));

                        // Producer only: tenant-service consumes no queue (Architecture §2.1).
                        return { consumers: [], producers };
                    }
                })
            ],
            providers: [SqsProducerService, SnsPublisherService, MessageEnvelopeService],
            exports: [SqsModule, SqsProducerService, SnsPublisherService, MessageEnvelopeService]
        };
    }
}
