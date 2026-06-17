import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@app/common/http/http-client.service';
import type { AllConfigType } from '@app/config/config.type';

@Injectable()
export class WorkflowOrchestrationClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>
    ) {
        this.baseUrl = this.configService.getOrThrow('services.workflowOrchestration.url', { infer: true });
    }

    async startWorkflow(req: { workflowType: string; input: Record<string, unknown> }) {
        // OAuth2 JWT added automatically by HttpClientService
        const { data } = await this.http.post(`${this.baseUrl}/internal/workflows/start`, req);

        return data;
    }

    async getWorkflowStatus(workflowId: string) {
        const { data } = await this.http.get(`${this.baseUrl}/internal/workflows/${workflowId}`);

        return data;
    }
}
