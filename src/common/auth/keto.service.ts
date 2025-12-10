import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { HttpClient } from '@mod/common/http/http.client';
import oryConfig from '@mod/config/ory.config';

export interface KetoRelationTuple {
    namespace: string;
    object: string;
    relation: string;
    subject_id?: string;
    subject_set?: {
        namespace: string;
        object: string;
        relation: string;
    };
}

export interface KetoCheckRequest {
    namespace: string;
    object: string;
    relation: string;
    subject_id: string;
}

export interface KetoCheckResponse {
    allowed: boolean;
}

@Injectable()
export class KetoService {
    private readonly readUrl: string;
    private readonly writeUrl: string;

    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigService
    ) {
        const oryCfg = this.config.getOrThrow<ConfigType<typeof oryConfig>>('oryConfig', { infer: true });
        this.readUrl = oryCfg.keto.readUrl;
        this.writeUrl = oryCfg.keto.writeUrl;
    }

    /**
     * Check if subject has permission
     * Example: check('campaigns', 'campaign-123', 'view', 'user-456')
     */
    async check(namespace: string, object: string, relation: string, subjectId: string): Promise<boolean> {
        try {
            const { data } = await this.http.post<KetoCheckResponse>(`${this.readUrl}/relation-tuples/check`, {
                namespace,
                object,
                relation,
                subject_id: subjectId
            } as KetoCheckRequest);

            return data.allowed;
        } catch (error) {
            // Keto returns 403 if not allowed, treat as false
            if ((error as any)?.response?.status === 403) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Batch check multiple permissions
     */
    async checkBatch(checks: Array<{ namespace: string; object: string; relation: string }>, subjectId: string): Promise<Record<string, boolean>> {
        const results = await Promise.all(
            checks.map(async ({ namespace, object, relation }) => {
                const allowed = await this.check(namespace, object, relation, subjectId);
                return { key: `${namespace}:${object}#${relation}`, allowed };
            })
        );

        return Object.fromEntries(results.map((r) => [r.key, r.allowed]));
    }

    /**
     * Create a relation tuple (grant permission)
     */
    async createTuple(tuple: KetoRelationTuple): Promise<void> {
        await this.http.put(`${this.writeUrl}/admin/relation-tuples`, tuple);
    }

    /**
     * Delete a relation tuple (revoke permission)
     */
    async deleteTuple(tuple: KetoRelationTuple): Promise<void> {
        await this.http.delete(`${this.writeUrl}/admin/relation-tuples`, {
            params: {
                namespace: tuple.namespace,
                object: tuple.object,
                relation: tuple.relation,
                subject_id: tuple.subject_id
            }
        });
    }
}
