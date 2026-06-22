import { Injectable } from '@nestjs/common';

import { AppLoggerService } from '@common/logging/app-logger.service';

/**
 * Custom-domain provisioning (ACM certificate + CloudFront alias).
 *
 * PLACEHOLDER — not implemented. DNS ownership is verified upstream (`DnsVerificationService`), but the
 * AWS provisioning that actually serves the domain (ACM cert request/validation + CloudFront distribution
 * alias) is not wired. That is a deliberate infra task — new AWS SDK clients, not testable on the local
 * stack — so a verified custom domain is currently recorded but **not served**.
 */
@Injectable()
export class DomainProvisioningService {
    constructor(private readonly logger: AppLoggerService) {
        this.logger.setContext(DomainProvisioningService.name);
    }

    /** No-op placeholder invoked when a custom domain passes DNS verification. */
    provisionDomain(tenantId: string, domain: string): void {
        this.logger.warn('Custom-domain provisioning is not implemented (placeholder); domain verified but not served', { tenantId, domain });
    }
}
