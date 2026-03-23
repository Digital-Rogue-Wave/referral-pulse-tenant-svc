import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@common/http/http-client.service';

import type { OryConfig } from '@config/ory.config';

import type { KratosIdentity } from '@app/types';

@Injectable()
export class KratosService {
    private readonly adminUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly config: ConfigService,
    ) {
        const oryCfg = this.config.getOrThrow<OryConfig>('oryConfig');
        this.adminUrl = oryCfg.kratos?.adminUrl || 'http://kratos:4434';
    }

    async getIdentity(identityId: string): Promise<KratosIdentity> {
        const response = await this.http.get<KratosIdentity>(`${this.adminUrl}/admin/identities/${identityId}`);
        if (!response.data) {
            throw new Error(`Identity not found: ${identityId}`);
        }
        return response.data;
    }

    async listIdentities(tenantId?: string): Promise<KratosIdentity[]> {
        const params: Record<string, string> = {};

        if (tenantId) {
            // Filter by tenant using metadata or traits
            params['metadata_public.tenant_id'] = tenantId;
        }

        const response = await this.http.get<KratosIdentity[]>(`${this.adminUrl}/admin/identities`, { params });

        return response.data ?? [];
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
            const response = await this.http.post<{ valid: boolean }>(
                `${this.adminUrl}/admin/identities/${identityId}/credentials/password/verify`,
                {
                    password,
                },
            );

            return response.data?.valid === true;
        } catch (error) {
            // If verification fails or endpoint returns error, password is invalid
            console.error(error);
            return false;
        }
    }

    async updateIdentityMetadata(
        identityId: string,
        metadata: {
            public?: Record<string, unknown>;
            admin?: Record<string, unknown>;
        },
    ): Promise<void> {
        const payload: {
            metadata_public?: Record<string, unknown>;
            metadata_admin?: Record<string, unknown>;
        } = {};
        if (metadata.public) {
            payload.metadata_public = metadata.public;
        }
        if (metadata.admin) {
            payload.metadata_admin = metadata.admin;
        }

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
