import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { SubdomainService } from './subdomain.service';
import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';

describe('SubdomainService', () => {
    let service: SubdomainService;
    let prisma: MockProxy<DatabaseService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;
    let logger: MockProxy<AppLoggerService>;
    let dateService: MockProxy<DateService>;

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        txEventEmitter = mock<TransactionEventEmitterService>();
        logger = mock<AppLoggerService>();
        dateService = mock<DateService>();

        // Mock prisma methods
        prisma.tenant = {
            count: jest.fn()
        } as any;
        prisma.reservedSubdomain = {
            count: jest.fn(),
            create: jest.fn()
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SubdomainService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: AppLoggerService, useValue: logger },
                { provide: DateService, useValue: dateService }
            ]
        }).compile();

        service = module.get<SubdomainService>(SubdomainService);
    });

    describe('validateSubdomain', () => {
        it('should allow valid subdomains', () => {
            expect(service.validateSubdomain('my-team').valid).toBe(true);
            expect(service.validateSubdomain('team123').valid).toBe(true);
            expect(service.validateSubdomain('abc').valid).toBe(true);
        });

        it('should reject invalid characters', () => {
            expect(service.validateSubdomain('MyTeam').valid).toBe(false);
            expect(service.validateSubdomain('my team').valid).toBe(false);
            expect(service.validateSubdomain('my_team').valid).toBe(false);
        });

        it('should reject subdomains starting or ending with hyphen', () => {
            expect(service.validateSubdomain('-team').valid).toBe(false);
            expect(service.validateSubdomain('team-').valid).toBe(false);
        });

        it('should reject invalid length', () => {
            expect(service.validateSubdomain('ab').valid).toBe(false);
            expect(service.validateSubdomain('a'.repeat(64)).valid).toBe(false);
        });

        it('should reject reserved subdomains', () => {
            expect(service.validateSubdomain('admin').valid).toBe(false);
            expect(service.validateSubdomain('app').valid).toBe(false);
            expect(service.validateSubdomain('www').valid).toBe(false);
        });
    });

    describe('isSubdomainAvailable', () => {
        it('should return true if subdomain is available', async () => {
            (prisma.tenant.count as jest.Mock).mockResolvedValue(0);
            (prisma.reservedSubdomain.count as jest.Mock).mockResolvedValue(0);

            const result = await service.isSubdomainAvailable('new-team');

            expect(result).toBe(true);
        });

        it('should return false if subdomain is taken by a tenant', async () => {
            (prisma.tenant.count as jest.Mock).mockResolvedValue(1);

            const result = await service.isSubdomainAvailable('taken-team');

            expect(result).toBe(false);
        });

        it('should return false if subdomain is reserved', async () => {
            (prisma.tenant.count as jest.Mock).mockResolvedValue(0);
            (prisma.reservedSubdomain.count as jest.Mock).mockResolvedValue(1);

            const result = await service.isSubdomainAvailable('reserved-team');

            expect(result).toBe(false);
        });

        it('should throw if subdomain format is invalid', async () => {
            await expect(service.isSubdomainAvailable('ab')).rejects.toThrow(BadRequestException);
        });
    });

    describe('reserveSubdomain', () => {
        it('should create a reservation', async () => {
            (prisma.tenant.count as jest.Mock).mockResolvedValue(0);
            (prisma.reservedSubdomain.count as jest.Mock).mockResolvedValue(0);
            const momentChain = {
                add: jest.fn().mockReturnThis(),
                toDate: jest.fn().mockReturnValue(new Date())
            };
            dateService.nowMoment.mockReturnValue(momentChain as unknown as ReturnType<DateService['nowMoment']>);
            (prisma.reservedSubdomain.create as jest.Mock).mockResolvedValue({
                slug: 'old-slug',
                originalTenantId: 'tenant-id',
                expiresAt: expect.any(Date)
            });

            await service.reserveSubdomain('old-slug', 'tenant-id', 7);

            expect(prisma.reservedSubdomain.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    slug: 'old-slug',
                    originalTenantId: 'tenant-id',
                    expiresAt: expect.any(Date)
                })
            });
        });
    });
});
