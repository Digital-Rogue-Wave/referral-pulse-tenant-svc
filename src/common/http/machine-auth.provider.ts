import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';
import { ServiceAuthProvider } from '@mod/types/app.interface';
import { BrokerTokenResponse } from '@mod/types/app.type';

@Injectable()
export class MachineAuthProvider implements ServiceAuthProvider {
    private readonly baseURL: string;
    private readonly timeoutMs: number;
    private readonly cache: LRUCache<string, string>;
    private readonly inflight = new Map<string, Promise<string>>();

    constructor(
        private readonly http: HttpService,
        private readonly cfg: ConfigService,
    ) {
        this.baseURL = this.cfg.getOrThrow<string>('cacheConfig.tokenBroker.baseURL', { infer: true });
        this.timeoutMs = this.cfg.getOrThrow<number>('cacheConfig.tokenBroker.timeoutMs', { infer: true });

        const maxEntries = this.cfg.get<number>('cacheConfig.tokenBroker.cacheMax', { infer: true }) ?? 2000;
        const maxBytes = this.cfg.get<number>('cacheConfig.tokenBroker.cacheMaxBytes', { infer: true }) ?? 4 * 1024 * 1024;

        this.cache = new LRUCache<string, string>({
            max: maxEntries,
            maxSize: maxBytes,
            sizeCalculation: (token: string) => Buffer.byteLength(token, 'utf8'),
            ttlAutopurge: true,
        });
    }

    async getHeaders(audience: string, tenantId?: string): Promise<Record<string, string>> {
        const token = await this.getToken(audience, tenantId);
        return {
            authorization: `Bearer ${token}`,
            ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
        };
    }

    private async getToken(audience: string, tenantId?: string): Promise<string> {
        const key = `${audience}|${tenantId ?? '-'}`;
        const cached = this.cache.get(key);
        if (cached) return cached;

        const pending = this.inflight.get(key);
        if (pending) return pending;

        const promise = this.fetchAndCache(key, audience, tenantId).finally(() => this.inflight.delete(key));
        this.inflight.set(key, promise);
        return promise;
    }

    private async fetchAndCache(key: string, audience: string, tenantId?: string): Promise<string> {
        const { data } = await this.http.axiosRef.post<BrokerTokenResponse>(
            '/internal/oauth2/token',
            { audience, tenantId, grant_type: 'client_credentials' },
            { baseURL: this.baseURL, timeout: this.timeoutMs },
        );

        const token = data.access_token;
        const ttlSec = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 300;
        const ttlMs = Math.max(60_000, Math.floor(ttlSec * 1000 * 0.8));

        this.cache.set(key, token, { ttl: ttlMs });
        return token;
    }
}
