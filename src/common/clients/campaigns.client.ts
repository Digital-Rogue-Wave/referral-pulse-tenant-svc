import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import servicesConfig from '@mod/config/services.config';
import { HttpClient } from '@mod/common/http/http.client';

@Injectable()
export class CampaignsClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigService,
    ) {
        const services = this.config.getOrThrow<ConfigType<typeof servicesConfig>>(
            'servicesConfig',
            { infer: true }
        );

        this.baseUrl = services.campaigns;
    }

    async getCampaign(req: { userId: string; campaignId: string }) {
        const { data } = await this.http.post(
            `${this.baseUrl}/internal/campaigns/{campaignId}/`,
            req
        );

        return data;
    }
}
