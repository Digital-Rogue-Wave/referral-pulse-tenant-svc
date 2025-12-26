import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'dns';

@Injectable()
export class DnsVerificationService {
    private readonly logger = new Logger(DnsVerificationService.name);

    async verifyTxtRecord(domain: string, expectedToken: string): Promise<boolean> {
        const challengeDomain = `_referral-pulse-challenge.${domain}`;
        this.logger.log(`Verifying TXT record for ${challengeDomain} with token ${expectedToken}`);
        const records = await dns.resolveTxt(challengeDomain);
        const flatRecords = records.flat();
        const isValid = flatRecords.includes(expectedToken);
        this.logger.log(`Verification result for ${domain}: ${isValid}`);
        return isValid;
    }
}
