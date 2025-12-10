import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import servicesConfig from '@mod/config/services.config';
import { HttpClient } from '@mod/common/http/http.client';

@Injectable()
export class RewardsClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigService
    ) {
        const services = this.config.getOrThrow<ConfigType<typeof servicesConfig>>('servicesConfig', { infer: true });

        this.baseUrl = services.rewards;
    }

    async grantReward(req: { userId: string; rewardType: string; amount: number }) {
        const { data } = await this.http.post(`${this.baseUrl}/internal/rewards/grant`, req);

        return data;
    }
}
