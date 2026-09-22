import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';

import { HttpClientService } from '@common/http/http-client.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import type { OryConfig } from '@config/ory.config';

import type { KratosIdentity } from '@app/types';

@Injectable()
export class KratosService {
    private readonly adminUrl: string;
    private readonly publicUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly config: ConfigService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(KratosService.name);
        const oryCfg = this.config.getOrThrow<OryConfig>('oryConfig');
        this.adminUrl = oryCfg.kratos.adminUrl;
        this.publicUrl = oryCfg.kratos.publicUrl;
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
     * Confirms an identity's password — the step-up check in front of destructive tenant actions.
     *
     * Kratos has no admin "verify password" endpoint, so this runs a native (API) login flow for the
     * identity's email and immediately revokes the session it creates. Verified against the running
     * Kratos: a correct password answers 200 with a session, a wrong one 400.
     *
     * The login POST runs with no retries and outside the circuit breaker: a wrong password is an
     * expected 4xx, and retrying it would multiply failed attempts while tripping the breaker would
     * take Kratos offline for every caller.
     */
    async verifyPassword(identityId: string, password: string): Promise<boolean> {
        const identity = await this.getIdentity(identityId);
        const email = identity.traits?.email;
        if (!email) {
            return false;
        }

        const flow = await this.http.get<{ id: string }>(`${this.publicUrl}/self-service/login/api`);
        let sessionId: string | undefined;
        try {
            const login = await this.http.post<{ session?: { id?: string } }>(
                `${this.publicUrl}/self-service/login`,
                { method: 'password', identifier: email, password },
                { params: { flow: flow.data.id }, retries: 0, skipCircuitBreaker: true }
            );
            sessionId = login.data.session?.id;
        } catch {
            // A rejected credential. The Ory error body can carry identity details, so nothing is logged from it.
            this.logger.warn('Password confirmation rejected', { identityId });
            return false;
        }

        if (sessionId) {
            await this.http.delete(`${this.adminUrl}/admin/sessions/${sessionId}`).catch(() => {
                this.logger.warn('Could not revoke the verification session', { identityId });
            });
        }
        return true;
    }

    async updateIdentityMetadata(
        identityId: string,
        metadata: {
            public?: Record<string, unknown>;
            admin?: Record<string, unknown>;
        }
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

    /**
     * Deletes an identity, its credentials and every session (erasure). Idempotent: an identity that is
     * already gone is not an error.
     */
    async deleteIdentity(identityId: string): Promise<void> {
        try {
            await this.http.delete(`${this.adminUrl}/admin/identities/${identityId}`, { retries: 0 });
        } catch (error) {
            if (isAxiosError(error) && error.response?.status === 404) {
                return;
            }
            throw error;
        }
    }
}
