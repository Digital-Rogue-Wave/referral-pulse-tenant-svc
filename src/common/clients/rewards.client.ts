import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@app/common/http/http-client.service';
import type { AllConfigType } from '@app/config/config.type';

@Injectable()
export class RewardsClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>,
    ) {
        this.baseUrl = this.configService.getOrThrow('services.rewards.url', {
            infer: true,
        });
    }

    async grantReward(req: { userId: string; rewardType: string; amount: number }) {
        const { data } = await this.http.post(`${this.baseUrl}/internal/rewards/grant`, req);

        return data;
    }
}
