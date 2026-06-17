import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@app/common/http/http-client.service';
import type { AllConfigType } from '@app/config/config.type';

@Injectable()
export class ContentAiClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>
    ) {
        this.baseUrl = this.configService.getOrThrow('services.contentAi.url', {
            infer: true
        });
    }

    async generateContent(req: { template: string; variables: Record<string, string> }) {
        const { data } = await this.http.post(`${this.baseUrl}/internal/generate`, req);

        return data;
    }

    async analyzeUrl(url: string) {
        const { data } = await this.http.post(`${this.baseUrl}/internal/analyze-url`, { url });

        return data;
    }
}
