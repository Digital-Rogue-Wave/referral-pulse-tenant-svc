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

    /**
     * Verify user password by attempting to create a session
     * @param identityId - The Kratos identity ID
     * @param password - The password to verify
     * @returns true if password is correct, false otherwise
     */
    async verifyPassword(identityId: string, password: string): Promise<boolean> {
        try {
            // Get identity to extract email/username
            const identity = await this.getIdentity(identityId);
            const email = identity.traits?.email;

            if (!email) {
                return false;
            }

            // Use Kratos native API to verify credentials
            // This endpoint validates password without creating a session
            const { data } = await this.http.post<{ valid: boolean }>(`${this.adminUrl}/admin/identities/${identityId}/credentials/password/verify`, {
                password
            });

            return data?.valid === true;
        } catch (error) {
            // If verification fails or endpoint returns error, password is invalid
            console.error(error);
            return false;
        }
    }

    async updateIdentityMetadata(identityId: string, metadata: { public?: any; admin?: any }): Promise<void> {
        const payload: any = {};
        if (metadata.public) payload.metadata_public = metadata.public;
        if (metadata.admin) payload.metadata_admin = metadata.admin;

        await this.http.patch(`${this.adminUrl}/admin/identities/${identityId}`, payload);
    }

    /**
     * Revoke all sessions for a user
     * @param identityId - The Kratos identity ID
     */
    async revokeSessions(identityId: string): Promise<void> {
        await this.http.delete(`${this.adminUrl}/admin/identities/${identityId}/sessions`);
    }
}
