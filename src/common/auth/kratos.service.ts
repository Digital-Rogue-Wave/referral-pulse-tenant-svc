import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import oryConfig from '@mod/config/ory.config';
import { KratosIdentity } from '@mod/types/app.interface';
import { HttpClient } from '@mod/common/http/http.client';

@Injectable()
export class KratosService {
    private readonly adminUrl: string;

    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigService
    ) {
        const oryCfg = this.config.getOrThrow<ConfigType<typeof oryConfig>>('oryConfig', { infer: true });
        this.adminUrl = oryCfg.kratos?.adminUrl || 'http://kratos:4434';
    }

    async getIdentity(identityId: string): Promise<KratosIdentity> {
        const { data } = await this.http.get<KratosIdentity>(`${this.adminUrl}/admin/identities/${identityId}`);
        return data;
    }

    async listIdentities(tenantId?: string): Promise<KratosIdentity[]> {
        const params: Record<string, string> = {};

        if (tenantId) {
            // Filter by tenant using metadata or traits
            params['metadata_public.tenant_id'] = tenantId;
        }

        const { data } = await this.http.get<KratosIdentity[]>(`${this.adminUrl}/admin/identities`, { params });

        return data;
    }
}
