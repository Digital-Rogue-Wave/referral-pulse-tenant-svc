import { registerAs } from '@nestjs/config';
import { IsString, IsOptional } from 'class-validator';
import validateConfig from '@mod/common/validators/validate-config';

export type TopicDef = {
    name: string;
    topicArn: string;
    fifo?: boolean;
};

class SnsEnvValidator {
    @IsString()
    @IsOptional()
    SNS_CAMPAIGN_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_REWARD_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_ANALYTICS_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_CONTENT_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_WORKFLOW_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_SDK_CONFIG_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_CLIENT_IDENTITY_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_TENANT_EVENTS_TOPIC_ARN?: string;

    @IsString()
    @IsOptional()
    SNS_REFERRAL_PLATFORM_EVENTS_TOPIC_ARN?: string;
}

export type SnsConfig = {
    topics: TopicDef[];
};

export default registerAs('snsConfig', () => {
    validateConfig(process.env, SnsEnvValidator);

    return {
        topics: [
            {
                name: 'campaign-events',
                topicArn: process.env.SNS_CAMPAIGN_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'reward-events',
                topicArn: process.env.SNS_REWARD_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'analytics-events',
                topicArn: process.env.SNS_ANALYTICS_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'content-events',
                topicArn: process.env.SNS_CONTENT_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'workflow-events',
                topicArn: process.env.SNS_WORKFLOW_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'sdk-config-events',
                topicArn: process.env.SNS_SDK_CONFIG_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'client-identity-events',
                topicArn: process.env.SNS_CLIENT_IDENTITY_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'tenant-events',
                topicArn: process.env.SNS_TENANT_EVENTS_TOPIC_ARN || '',
                fifo: true
            },
            {
                name: 'referral-platform-events',
                topicArn: process.env.SNS_REFERRAL_PLATFORM_EVENTS_TOPIC_ARN || process.env.SNS_TENANT_EVENTS_TOPIC_ARN || '',
                fifo: true
            }
        ]
    };
});
