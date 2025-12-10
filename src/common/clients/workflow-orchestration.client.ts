import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import servicesConfig from '@mod/config/services.config';
import { HttpClient } from '@mod/common/http/http.client';

@Injectable()
export class WorkflowOrchestrationClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigService
    ) {
        const services = this.config.getOrThrow<ConfigType<typeof servicesConfig>>('servicesConfig', { infer: true });

        this.baseUrl = services.workflowOrchestration;
    }

    async startWorkflow(req: { workflowType: string; input: Record<string, unknown> }) {
        // OAuth2 JWT added automatically by HttpClient
        const { data } = await this.http.post(`${this.baseUrl}/internal/workflows/start`, req);

        return data;
    }

    async getWorkflowStatus(workflowId: string) {
        const { data } = await this.http.get(`${this.baseUrl}/internal/workflows/${workflowId}`);

        return data;
    }
}
