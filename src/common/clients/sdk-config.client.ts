import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import servicesConfig from '@mod/config/services.config';
import { HttpClient } from '@mod/common/http/http.client';

@Injectable()
export class SdkConfigClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigService
    ) {
        const services = this.config.getOrThrow<ConfigType<typeof servicesConfig>>('servicesConfig', { infer: true });

        this.baseUrl = services.sdkConfig;
    }

    async getCampaign(req: { userId: string; campaignId: string }) {
        const { data } = await this.http.post(`${this.baseUrl}/internal/sdk-config/{campaignId}/`, req);

        return data;
    }
}
