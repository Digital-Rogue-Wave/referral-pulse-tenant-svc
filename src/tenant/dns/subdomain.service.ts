import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { TenantEntity } from '../tenant.entity';
import { ReservedSubdomainEntity } from '../reserved-subdomain.entity';
import { RESERVED_SUBDOMAINS } from './reserved-subdomains.constant';

@Injectable()
export class SubdomainService {
    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        @InjectRepository(ReservedSubdomainEntity)
        private readonly reservedRepository: Repository<ReservedSubdomainEntity>
    ) {}

    validateSubdomain(subdomain: string): void {
        const regex = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

        if (!regex.test(subdomain)) {
            throw new HttpException(
                {
                    message:
                        'Subdomain must consist of lowercase alphanumeric characters or hyphens, cannot start or end with a hyphen, and must be between 3 and 63 characters (actual regex logic may vary slightly but min 3 chars is standard)',
                    code: HttpStatus.BAD_REQUEST
                },
                HttpStatus.BAD_REQUEST
            );
        }

        if (subdomain.length < 3 || subdomain.length > 63) {
            throw new HttpException(
                {
                    message: 'Subdomain length must be between 3 and 63 characters',
                    code: HttpStatus.BAD_REQUEST
                },
                HttpStatus.BAD_REQUEST
            );
        }

        if (RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
            throw new HttpException(
                {
                    message: 'This subdomain is reserved and cannot be used',
                    code: HttpStatus.BAD_REQUEST
                },
                HttpStatus.BAD_REQUEST
            );
        }
    }

    async isSubdomainAvailable(subdomain: string): Promise<boolean> {
        // Validate first
        this.validateSubdomain(subdomain);
        const count = await this.tenantRepository.count({
            where: { slug: subdomain }
        });

        if (count > 0) {
            return false;
        }

        const reservedCount = await this.reservedRepository.count({
            where: {
                slug: subdomain,
                expiresAt: MoreThan(new Date())
            }
        });

        return reservedCount === 0;
    }

    async reserveSubdomain(slug: string, tenantId: string, days: number = 7): Promise<void> {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        await this.reservedRepository.save({
            slug,
            expiresAt,
            originalTenantId: tenantId
        });
    }
}
