import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@app/common/http/http-client.service';
import type { AllConfigType } from '@app/config/config.type';

@Injectable()
export class CampaignsClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>
    ) {
        this.baseUrl = this.configService.get('services.campaigns.url', { infer: true }) || 'http://campaign-service';
    }

    async getCampaign(campaignId: string, tenantId: string): Promise<Record<string, unknown>> {
        const { data } = await this.http.get<Record<string, unknown>>(`${this.baseUrl}/api/v1/internal/campaigns/${campaignId}`, {
            params: { tenantId }
        });
        return data;
    }

    async checkBudget(campaignId: string, amount: number, tenantId: string): Promise<boolean> {
        const { data } = await this.http.get<{ isOk: boolean }>(`${this.baseUrl}/api/v1/internal/campaigns/${campaignId}/check-budget`, {
            params: { amount, tenantId }
        });
        return data.isOk;
    }

    async incrementSpend(campaignId: string, amount: number, tenantId: string): Promise<void> {
        await this.http.post(`${this.baseUrl}/api/v1/internal/campaigns/${campaignId}/increment-spend`, {
            amount,
            tenantId
        });
    }
}
