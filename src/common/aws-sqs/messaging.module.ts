import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import sqsConfig from '@mod/config/sqs.config';
import snsConfig from '@mod/config/sns.config';
import { SnsModule } from './sns.module';
import { SqsManager } from './sqs.manager';
import { SnsPublisher } from './sns.publisher';
import { SqsMessagingModule } from '@mod/common/aws-sqs/sqs.module';

@Global()
@Module({})
export class MessagingModule {
    static register(): DynamicModule {
        return {
            module: MessagingModule,
            imports: [ConfigModule.forFeature(sqsConfig), ConfigModule.forFeature(snsConfig), SqsMessagingModule.register(), SnsModule],
            providers: [SqsManager, SnsPublisher],
            exports: [SqsManager, SnsPublisher, SqsMessagingModule]
        };
    }
}
