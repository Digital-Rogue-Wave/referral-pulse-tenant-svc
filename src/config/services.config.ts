import { registerAs } from '@nestjs/config';
import { IsUrl } from 'class-validator';
import validateConfig from '@mod/common/validators/validate-config';

export type ServicesConfig = {
    clientIdentity: string;
    rewards: string;
    contentAi: string;
    analytics: string;
    sdkConfig: string;
    workflowOrchestration: string;
};

class ServicesEnvValidator {
    @IsUrl({ require_tld: false })
    SERVICE_CLIENT_IDENTITY_URL!: string;

    @IsUrl({ require_tld: false })
    SERVICE_REWARDS_URL!: string;

    @IsUrl({ require_tld: false })
    SERVICE_CONTENT_AI_URL!: string;

    @IsUrl({ require_tld: false })
    SERVICE_ANALYTICS_URL!: string;

    @IsUrl({ require_tld: false })
    SERVICE_SDK_CONFIG_URL!: string;

    @IsUrl({ require_tld: false })
    SERVICE_CAMPAIGNS_URL!: string;

    @IsUrl({ require_tld: false })
    SERVICE_WORKFLOW_ORCHESTRATION_URL!: string;
}

export default registerAs<ServicesConfig>('servicesConfig', () => {
    validateConfig(process.env, ServicesEnvValidator);

    return {
        clientIdentity: process.env.SERVICE_CLIENT_IDENTITY_URL as string,
        rewards: process.env.SERVICE_REWARDS_URL as string,
        contentAi: process.env.SERVICE_CONTENT_AI_URL as string,
        analytics: process.env.SERVICE_ANALYTICS_URL as string,
        sdkConfig: process.env.SERVICE_SDK_CONFIG_URL as string,
        campaigns: process.env.SERVICE_CAMPAIGNS_URL as string,
        workflowOrchestration: process.env.SERVICE_WORKFLOW_ORCHESTRATION_URL as string
    };
});
