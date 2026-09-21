import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpClientService } from '@common/http/http-client.service';

import type { OryConfig } from '@config/ory.config';

export interface KetoSubjectSet {
    namespace: string;
    object: string;
    relation: string;
}

export interface KetoRelationTuple {
    namespace: string;
    object: string;
    relation: string;
    subject_id?: string;
    subject_set?: KetoSubjectSet;
}

/** Filter for list / delete-by-query. Every field is optional; Keto ANDs the given ones. */
export interface KetoTupleQuery {
    namespace: string;
    object?: string;
    relation?: string;
    subject_id?: string;
}

export type KetoPatchAction = 'insert' | 'delete';

export interface KetoTuplePatch {
    action: KetoPatchAction;
    relation_tuple: KetoRelationTuple;
}

interface KetoCheckResponse {
    allowed: boolean;
}

interface KetoListResponse {
    relation_tuples: KetoRelationTuple[];
    next_page_token: string;
}

/**
 * Thin Ory Keto REST client. Verified against the running Keto:
 * - `POST /relation-tuples/check/openapi` always answers 200 `{allowed}` (the plain `/check` answers 403 on deny).
 * - `PATCH /admin/relation-tuples` applies a batch of insert/delete atomically; inserting an existing
 *   tuple or deleting a missing one is a no-op, so replaying a patch is safe.
 * - `DELETE /admin/relation-tuples?…` deletes every tuple matching the query.
 */
@Injectable()
export class KetoService {
    private readonly readUrl: string;
    private readonly writeUrl: string;

    constructor(
        private readonly http: HttpClientService,
        private readonly config: ConfigService
    ) {
        const oryCfg = this.config.getOrThrow<OryConfig>('oryConfig');
        this.readUrl = oryCfg.keto.readUrl;
        this.writeUrl = oryCfg.keto.writeUrl;
    }

    /** Does `subjectId` hold `relation` on `namespace:object`, directly or through a subject set? */
    async check(namespace: string, object: string, relation: string, subjectId: string): Promise<boolean> {
        const response = await this.http.post<KetoCheckResponse>(`${this.readUrl}/relation-tuples/check/openapi`, {
            namespace,
            object,
            relation,
            subject_id: subjectId
        });
        return response.data.allowed;
    }

    async patchTuples(patches: KetoTuplePatch[]): Promise<void> {
        if (patches.length === 0) {
            return;
        }
        await this.http.patch(`${this.writeUrl}/admin/relation-tuples`, patches);
    }

    async createTuple(tuple: KetoRelationTuple): Promise<void> {
        await this.patchTuples([{ action: 'insert', relation_tuple: tuple }]);
    }

    async deleteTuple(tuple: KetoRelationTuple): Promise<void> {
        await this.patchTuples([{ action: 'delete', relation_tuple: tuple }]);
    }

    async deleteTuples(query: KetoTupleQuery): Promise<void> {
        await this.http.delete(`${this.writeUrl}/admin/relation-tuples`, { params: { ...query } });
    }

    /** Every tuple matching the query, following Keto's page tokens. */
    async listTuples(query: KetoTupleQuery): Promise<KetoRelationTuple[]> {
        const tuples: KetoRelationTuple[] = [];
        let pageToken = '';
        do {
            const response = await this.http.get<KetoListResponse>(`${this.readUrl}/relation-tuples`, {
                params: { ...query, page_size: 500, ...(pageToken ? { page_token: pageToken } : {}) }
            });
            tuples.push(...response.data.relation_tuples);
            pageToken = response.data.next_page_token;
        } while (pageToken);
        return tuples;
    }
}
