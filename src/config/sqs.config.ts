import { registerAs } from '@nestjs/config';
import { IsString, IsOptional, IsUrl } from 'class-validator';
import validateConfig from '@mod/common/validators/validate-config';

export type ProducerDef = {
    name: string;
    queueUrl: string;
    fifo?: boolean;
    dlqUrl?: string;
};

export type ConsumerDef = {
    name: string;
    queueUrl: string;
    fifo?: boolean;
    batchSize?: number;
    waitTimeSeconds?: number;
    visibilityTimeout?: number;
    dlqUrl?: string;
};

class SqsEnvValidator {
    @IsString() @IsOptional()
    SQS_ENDPOINT?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_CAMPAIGN_EVENTS_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_CAMPAIGN_EVENTS_DLQ_URL?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_REWARD_EVENTS_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_REWARD_EVENTS_DLQ_URL?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_ANALYTICS_EVENTS_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_ANALYTICS_EVENTS_DLQ_URL?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_CONTENT_EVENTS_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_CONTENT_EVENTS_DLQ_URL?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_WORKFLOW_EVENTS_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_WORKFLOW_EVENTS_DLQ_URL?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_SDK_CONFIG_EVENTS_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_SDK_CONFIG_EVENTS_DLQ_URL?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_CLIENT_IDENTITY_EVENTS_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_CLIENT_IDENTITY_EVENTS_DLQ_URL?: string;

    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_EVENT_TRACKING_INGESTION_QUEUE_URL?: string;
    @IsUrl({ require_tld: false }) @IsOptional()
    SQS_EVENT_TRACKING_INGESTION_DLQ_URL?: string;
}

export default registerAs('sqsConfig', () => {
    validateConfig(process.env, SqsEnvValidator);

    return {
        endpoint: process.env.SQS_ENDPOINT,

        // Producers (queues this service sends to)
        producers: [
            {
                name: 'campaign-events',
                queueUrl: process.env.SQS_CAMPAIGN_EVENTS_QUEUE_URL || '',
                fifo: true,
                dlqUrl: process.env.SQS_CAMPAIGN_EVENTS_DLQ_URL,
            },
            {
                name: 'reward-events',
                queueUrl: process.env.SQS_REWARD_EVENTS_QUEUE_URL || '',
                fifo: true,
                dlqUrl: process.env.SQS_REWARD_EVENTS_DLQ_URL,
            },
            {
                name: 'analytics-events',
                queueUrl: process.env.SQS_ANALYTICS_EVENTS_QUEUE_URL || '',
                fifo: true,
                dlqUrl: process.env.SQS_ANALYTICS_EVENTS_DLQ_URL,
            },
            {
                name: 'content-events',
                queueUrl: process.env.SQS_CONTENT_EVENTS_QUEUE_URL || '',
                fifo: true,
                dlqUrl: process.env.SQS_CONTENT_EVENTS_DLQ_URL,
            },
            {
                name: 'workflow-events',
                queueUrl: process.env.SQS_WORKFLOW_EVENTS_QUEUE_URL || '',
                fifo: true,
                dlqUrl: process.env.SQS_WORKFLOW_EVENTS_DLQ_URL,
            },
            {
                name: 'sdk-config-events',
                queueUrl: process.env.SQS_SDK_CONFIG_EVENTS_QUEUE_URL || '',
                fifo: true,
                dlqUrl: process.env.SQS_SDK_CONFIG_EVENTS_DLQ_URL,
            },
            {
                name: 'client-identity-events',
                queueUrl: process.env.SQS_CLIENT_IDENTITY_EVENTS_QUEUE_URL || '',
                fifo: true,
                dlqUrl: process.env.SQS_CLIENT_IDENTITY_EVENTS_DLQ_URL,
            },
        ],

        // Consumers (queues this service receives from)
        consumers: [
            {
                name: 'campaign-events',
                queueUrl: process.env.SQS_CAMPAIGN_EVENTS_QUEUE_URL || '',
                fifo: true,
                batchSize: 1, // FIFO: process one at a time for ordering
                waitTimeSeconds: 20,
                visibilityTimeout: 30,
                dlqUrl: process.env.SQS_CAMPAIGN_EVENTS_DLQ_URL,
            },
            {
                name: 'reward-events',
                queueUrl: process.env.SQS_REWARD_EVENTS_QUEUE_URL || '',
                fifo: true,
                batchSize: 1,
                waitTimeSeconds: 20,
                visibilityTimeout: 30,
                dlqUrl: process.env.SQS_REWARD_EVENTS_DLQ_URL,
            },
        ],
    };
});
