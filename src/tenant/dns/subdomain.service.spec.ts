import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubdomainService } from './subdomain.service';
import { TenantEntity } from '../tenant.entity';
import { ReservedSubdomainEntity } from '../reserved-subdomain.entity';
import { HttpException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';

describe('SubdomainService', () => {
    let service: SubdomainService;
    let tenantRepository: DeepMocked<Repository<TenantEntity>>;
    let reservedRepository: DeepMocked<Repository<ReservedSubdomainEntity>>;

    beforeEach(async () => {
        tenantRepository = createMock<Repository<TenantEntity>>();
        reservedRepository = createMock<Repository<ReservedSubdomainEntity>>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SubdomainService,
                {
                    provide: getRepositoryToken(TenantEntity),
                    useValue: tenantRepository
                },
                {
                    provide: getRepositoryToken(ReservedSubdomainEntity),
                    useValue: reservedRepository
                }
            ]
        }).compile();

        service = module.get<SubdomainService>(SubdomainService);
    });

    describe('validateSubdomain', () => {
        it('should allow valid subdomains', () => {
            expect(() => service.validateSubdomain('my-team')).not.toThrow();
            expect(() => service.validateSubdomain('team123')).not.toThrow();
            expect(() => service.validateSubdomain('abc')).not.toThrow();
        });

        it('should throw for invalid characters', () => {
            expect(() => service.validateSubdomain('MyTeam')).toThrow(HttpException);
            expect(() => service.validateSubdomain('my team')).toThrow(HttpException);
            expect(() => service.validateSubdomain('my_team')).toThrow(HttpException);
        });

        it('should throw for starting or ending with hyphen', () => {
            expect(() => service.validateSubdomain('-team')).toThrow(HttpException);
            expect(() => service.validateSubdomain('team-')).toThrow(HttpException);
        });

        it('should throw for invalid length', () => {
            expect(() => service.validateSubdomain('ab')).toThrow(HttpException);
            expect(() => service.validateSubdomain('a'.repeat(64))).toThrow(HttpException);
        });

        it('should throw for reserved subdomains', () => {
            expect(() => service.validateSubdomain('admin')).toThrow(HttpException);
            expect(() => service.validateSubdomain('app')).toThrow(HttpException);
            expect(() => service.validateSubdomain('www')).toThrow(HttpException);
        });
    });

    describe('isSubdomainAvailable', () => {
        it('should return true if available', async () => {
            tenantRepository.count.mockResolvedValue(0);
            reservedRepository.count.mockResolvedValue(0);

            const result = await service.isSubdomainAvailable('new-team');
            expect(result).toBe(true);
        });

        it('should return false if taken by a tenant', async () => {
            tenantRepository.count.mockResolvedValue(1);

            const result = await service.isSubdomainAvailable('taken-team');
            expect(result).toBe(false);
        });

        it('should return false if reserved', async () => {
            tenantRepository.count.mockResolvedValue(0);
            reservedRepository.count.mockResolvedValue(1);

            const result = await service.isSubdomainAvailable('reserved-team');
            expect(result).toBe(false);
        });

        it('should throw if subdomain is invalid', async () => {
            await expect(service.isSubdomainAvailable('ab')).rejects.toThrow(HttpException);
        });
    });

    describe('reserveSubdomain', () => {
        it('should save a reservation', async () => {
            await service.reserveSubdomain('slug', 'tenant-id', 7);

            expect(reservedRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    slug: 'slug',
                    originalTenantId: 'tenant-id',
                    expiresAt: expect.any(Date)
                })
            );
        });
    });
});
