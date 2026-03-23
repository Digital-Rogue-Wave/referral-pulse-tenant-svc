import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@app/common/http/http-client.service';
import type { AllConfigType } from '@app/config/config.type';

@Injectable()
export class AnalyticsClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>,
    ) {
        this.baseUrl = this.configService.getOrThrow('services.analytics.url', {
            infer: true,
        });
    }

    async getCampaignAnalytics(campaignId: string) {
        const { data } = await this.http.get(`${this.baseUrl}/internal/analytics/campaigns/${campaignId}`);

        return data;
    }

    async getBulkCampaignAnalytics(campaignIds: string[]) {
        const { data } = await this.http.post(`${this.baseUrl}/internal/analytics/campaigns/bulk`, { campaignIds });

        return data;
    }
}
