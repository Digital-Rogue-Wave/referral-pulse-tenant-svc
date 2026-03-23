import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HttpModule } from '@app/common/http/http.module';
import servicesConfig from '@app/config/services.config';

import { AnalyticsClient } from './analytics.client';
import { CampaignsClient } from './campaigns.client';
import { ClientIdentityClient } from './client-identity.client';
import { ContentAiClient } from './content-ai.client';
import { RewardsClient } from './rewards.client';
import { SdkConfigClient } from './sdk-config.client';
import { WorkflowOrchestrationClient } from './workflow-orchestration.client';

@Global()
@Module({
    imports: [ConfigModule.forFeature(servicesConfig), HttpModule],
    providers: [
        WorkflowOrchestrationClient,
        ContentAiClient,
        RewardsClient,
        CampaignsClient,
        SdkConfigClient,
        AnalyticsClient,
        ClientIdentityClient,
    ],
    exports: [
        WorkflowOrchestrationClient,
        ContentAiClient,
        RewardsClient,
        CampaignsClient,
        SdkConfigClient,
        AnalyticsClient,
        ClientIdentityClient,
    ],
})
export class ClientsModule {}
