import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@app/common/http/http-client.service';
import type { AllConfigType } from '@app/config/config.type';

@Injectable()
export class SdkConfigClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>,
    ) {
        this.baseUrl = this.configService.getOrThrow('services.sdkConfig.url', {
            infer: true,
        });
    }

    async getCampaign(req: { userId: string; campaignId: string }) {
        const { data } = await this.http.post(`${this.baseUrl}/internal/sdk-config/{campaignId}/`, req);

        return data;
    }
}
