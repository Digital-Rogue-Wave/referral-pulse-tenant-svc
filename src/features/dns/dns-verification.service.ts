import { Injectable } from '@nestjs/common';
import { promises as dns } from 'dns';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { DomainVerificationResult } from '@domains/dns';

/**
 * Service for DNS verification of custom domains
 */
@Injectable()
export class DnsVerificationService {
    constructor(private readonly logger: AppLoggerService) {
        this.logger.setContext(DnsVerificationService.name);
    }

    /**
     * Verify TXT record for domain ownership
     */
    async verifyTxtRecord(domain: string, expectedToken: string): Promise<DomainVerificationResult> {
        const challengeDomain = `_referral-pulse-challenge.${domain}`;

        this.logger.log(`Verifying TXT record for ${challengeDomain}`, {
            domain,
            challengeDomain
        });

        try {
            const records = await dns.resolveTxt(challengeDomain);
            const flatRecords = records.flat();
            const isValid = flatRecords.includes(expectedToken);

            this.logger.log(`Verification result for ${domain}: ${isValid}`, {
                domain,
                verified: isValid
            });

            return {
                verified: isValid,
                domain,
                message: isValid ? 'Domain ownership verified successfully' : 'TXT record not found or does not match expected token'
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown DNS error';

            this.logger.warn(`DNS verification failed for ${domain}`, {
                domain,
                error: errorMessage
            });

            return {
                verified: false,
                domain,
                message: `DNS lookup failed: ${errorMessage}`
            };
        }
    }

    /**
     * Check if a CNAME record points to expected target
     */
    async verifyCnameRecord(domain: string, expectedTarget: string): Promise<DomainVerificationResult> {
        try {
            const records = await dns.resolveCname(domain);
            const isValid = records.some(
                (record) => record.toLowerCase() === expectedTarget.toLowerCase() || record.toLowerCase().endsWith(`.${expectedTarget.toLowerCase()}`)
            );

            return {
                verified: isValid,
                domain,
                message: isValid ? 'CNAME record verified successfully' : `CNAME record does not point to ${expectedTarget}`
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown DNS error';

            return {
                verified: false,
                domain,
                message: `CNAME lookup failed: ${errorMessage}`
            };
        }
    }
}
