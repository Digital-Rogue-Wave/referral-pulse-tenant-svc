import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import servicesConfig from '@mod/config/services.config';
import { HttpClientsModule } from '@mod/common/http/http-clients.module';
import { WorkflowOrchestrationClient } from './workflow-orchestration.client';
import { ContentAiClient } from './content-ai.client';
import { RewardsClient } from './rewards.client';
import { CampaignsClient } from '@mod/common/clients/campaigns.client';
import { SdkConfigClient } from '@mod/common/clients/sdk-config.client';
import { AnalyticsClient } from '@mod/common/clients/analytics.client';

@Global()
@Module({
    imports: [
        ConfigModule.forFeature(servicesConfig),
        HttpClientsModule.register(),
    ],
    providers: [
        WorkflowOrchestrationClient,
        ContentAiClient,
        RewardsClient,
        CampaignsClient,
        SdkConfigClient,
        AnalyticsClient,
    ],
    exports: [
        WorkflowOrchestrationClient,
        ContentAiClient,
        RewardsClient,
        CampaignsClient,
        SdkConfigClient,
        AnalyticsClient,
    ],
})
export class ClientsModule {}
