import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantContext } from '@mod/types/app.interface';

type KeySegment = string | number;

@Injectable()
export class RedisKeyBuilder {
    private readonly prefix?: string;

    constructor(
        private readonly configService: ConfigService,
        @Optional() @Inject(TenantContext) private readonly tenant?: TenantContext,
    ) {
        this.prefix = this.configService.getOrThrow<string>('redisConfig.keyPrefix', { infer: true });
    }

    /**
     * Build a Redis key as: <prefix>[:<tenantId>]:<seg1>[:<seg2>]...
     * Examples:
     *  build('apikey', apiKey)
     *  build('ingest','dup', tenantId, campaignId, eventId)
     */
    build(...segments: ReadonlyArray<KeySegment>): string {
        const parts: string[] = [];

        if (this.prefix) parts.push(this.prefix);

        const tenantId = this.tenant?.getTenantId?.();
        if (tenantId) parts.push(String(tenantId));

        for (const seg of segments) {
            const s = String(seg);
            if (s.length > 0) parts.push(s);
        }

        return parts.join(':');
    }
}
