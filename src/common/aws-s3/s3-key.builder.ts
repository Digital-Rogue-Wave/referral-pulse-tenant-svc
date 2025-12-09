import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsTenantContext } from '@mod/common/tenant/cls-tenant-context.provider';

@Injectable()
export class S3KeyBuilder {
    private readonly prefix: string;

    constructor(
        private readonly configService: ConfigService,
        @Optional() private readonly tenant?: ClsTenantContext,
    ) {
        this.prefix = this.configService.getOrThrow<string>('s3Config.keyPrefix', { infer: true });
    }

    /**
     * Build an S3 object key with optional global prefix and tenantId segment.
     * Result: [prefix/][tenantId/]<key> (no leading slash)
     */
    build(key: string): string {
        const trimmed = key.replace(/^\/+/, '');
        const parts: string[] = [];
        if (this.prefix) parts.push(this.stripSlashes(this.prefix));
        const tenantId = this.tenant?.getTenantId();
        if (tenantId) parts.push(String(tenantId));
        parts.push(trimmed);
        return parts.join('/');
    }

    private stripSlashes(value: string): string {
        return value.replace(/^\/+/, '').replace(/\/+$/, '');
    }
}
