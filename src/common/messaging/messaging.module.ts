import { Module, DynamicModule } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';

import { SqsModule } from '@ssut/nestjs-sqs';

import { Environment, TENANT_SVC_FIFO } from '@app/types';

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

                        const sqs = configService.getOrThrow('aws.sqs', { infer: true });
                        // One inbound queue, for the consent registry. Architecture §2.1 says this
                        // service "Consumes: None", which Product Spec R-CPL-01 contradicts by making
                        // it the owner of the consent registry while API Contract §3.15 puts consent on
                        // touch events and nowhere else — so the only way to hold the registry is to
                        // read the bus. Recorded in NOTE.md §V5.16; §2.1 is being corrected.
                        const inbound = queues.filter((queue) => queue.name === TENANT_SVC_FIFO);
                        const consumers =
                            sqs.pollingEnabled && inbound.length > 0
                                ? inbound.map((queue) => ({
                                      name: queue.name,
                                      queueUrl: queue.url,
                                      region,
                                      batchSize: sqs.defaultBatchSize,
                                      visibilityTimeout: sqs.defaultVisibilityTimeout,
                                      waitTimeSeconds: sqs.defaultWaitTimeSeconds,
                                      terminateVisibilityTimeout: true,
                                      ...(endpoint && { endpoint }),
                                      ...(credentials && { credentials })
                                  }))
                                : [];

                        return { consumers, producers };
                    }
                })
            ],
            providers: [SqsProducerService, SnsPublisherService, MessageEnvelopeService],
            exports: [SqsModule, SqsProducerService, SnsPublisherService, MessageEnvelopeService]
        };
    }
}
