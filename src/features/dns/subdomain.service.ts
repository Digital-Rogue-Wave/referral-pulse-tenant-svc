import { Injectable, BadRequestException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import {
    ReservedSubdomainProps,
    SubdomainValidationResult,
    SubdomainReservedEvent,
    SubdomainReleasedEvent,
} from '@domains/dns';

import { RESERVED_SUBDOMAINS } from './reserved-subdomains.constant';

/**
 * Service for subdomain validation and reservation
 * Note: This is NOT tenant-scoped as subdomains are globally unique
 */
@Injectable()
export class SubdomainService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(SubdomainService.name);
    }

    /**
     * Validate subdomain format
     */
    validateSubdomain(subdomain: string): SubdomainValidationResult {
        // eslint-disable-next-line security/detect-unsafe-regex -- Standard RFC-compliant subdomain regex, linear complexity
        const regex = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

        if (!regex.test(subdomain)) {
            return {
                valid: false,
                message:
                    'Subdomain must consist of lowercase alphanumeric characters or hyphens, cannot start or end with a hyphen',
            };
        }

        if (subdomain.length < 3 || subdomain.length > 63) {
            return {
                valid: false,
                message: 'Subdomain length must be between 3 and 63 characters',
            };
        }

        if (RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
            return {
                valid: false,
                message: 'This subdomain is reserved and cannot be used',
            };
        }

        return { valid: true };
    }

    /**
     * Check if a subdomain is available
     */
    async isSubdomainAvailable(subdomain: string): Promise<boolean> {
        // Validate format first
        const validation = this.validateSubdomain(subdomain);
        if (!validation.valid) {
            throw new BadRequestException(validation.message);
        }

        // Check if used by any tenant
        const tenantCount = await this.prisma.tenant.count({
            where: { slug: subdomain },
        });

        if (tenantCount > 0) {
            return false;
        }

        // Check if reserved
        const reservedCount = await this.prisma.reservedSubdomain.count({
            where: {
                slug: subdomain,
                expiresAt: { gt: new Date() },
                deletedAt: null,
            },
        });

        return reservedCount === 0;
    }

    /**
     * Check subdomain availability with validation result
     */
    async checkSubdomain(subdomain: string): Promise<SubdomainValidationResult> {
        const validation = this.validateSubdomain(subdomain);
        if (!validation.valid) {
            return validation;
        }

        const available = await this.isSubdomainAvailable(subdomain);
        return {
            valid: true,
            available,
            message: available ? 'Subdomain is available' : 'Subdomain is taken',
        };
    }

    /**
     * Reserve a subdomain for a tenant
     */
    async reserveSubdomain(
        slug: string,
        tenantId: string,
        days: number = 7,
        userId?: string,
    ): Promise<ReservedSubdomainProps> {
        // Validate first
        const validation = this.validateSubdomain(slug);
        if (!validation.valid) {
            throw new BadRequestException(validation.message);
        }

        // Check availability
        const available = await this.isSubdomainAvailable(slug);
        if (!available) {
            throw new BadRequestException(`Subdomain "${slug}" is not available`);
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        const saved = (await this.prisma.reservedSubdomain.create({
            data: {
                slug,
                expiresAt,
                originalTenantId: tenantId,
            },
        })) as ReservedSubdomainProps;

        const event = new SubdomainReservedEvent(
            slug,
            tenantId,
            {
                slug,
                tenantId,
                expiresAt,
                reservedAt: new Date(),
            },
            userId,
        );
        this.txEventEmitter.emitAfterCommit('dns.reserved', event);
        this.txEventEmitter.emitAfterCommit('audit.dns.reserved', event);

        this.logger.log(`Subdomain reserved: ${slug}`, {
            slug,
            tenantId,
            expiresAt,
        });

        return saved;
    }

    /**
     * Release a subdomain reservation
     */
    async releaseSubdomain(slug: string, tenantId: string, userId?: string): Promise<void> {
        const existing = await this.prisma.reservedSubdomain.findUnique({
            where: { slug },
        });

        if (!existing) {
            throw new BadRequestException(`No reservation found for "${slug}"`);
        }

        if (existing.originalTenantId !== tenantId) {
            throw new BadRequestException('Cannot release reservation owned by another tenant');
        }

        await this.prisma.reservedSubdomain.update({
            where: { slug },
            data: { deletedAt: new Date() },
        });

        const event = new SubdomainReleasedEvent(
            slug,
            tenantId,
            {
                slug,
                tenantId,
                releasedAt: new Date(),
            },
            userId,
        );
        this.txEventEmitter.emitAfterCommit('dns.released', event);
        this.txEventEmitter.emitAfterCommit('audit.dns.released', event);

        this.logger.log(`Subdomain released: ${slug}`, { slug, tenantId });
    }

    /**
     * Get active reservation for a subdomain
     */
    async getReservation(slug: string): Promise<ReservedSubdomainProps | null> {
        return (await this.prisma.reservedSubdomain.findFirst({
            where: {
                slug,
                expiresAt: { gt: new Date() },
                deletedAt: null,
            },
        })) as ReservedSubdomainProps | null;
    }

    /**
     * Clean up expired reservations (for scheduled job)
     */
    async cleanupExpiredReservations(): Promise<number> {
        const result = await this.prisma.reservedSubdomain.updateMany({
            where: {
                expiresAt: { lt: new Date() },
                deletedAt: null,
            },
            data: { deletedAt: new Date() },
        });

        this.logger.log(`Cleaned up ${result.count} expired subdomain reservations`);
        return result.count;
    }
}
