import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AwareTenantService } from './aware-tenant.service';
import { TenantEntity } from '../tenant.entity';
import { FilesService } from '@mod/files/files.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KratosService } from '@mod/common/auth/kratos.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { SubdomainService } from '../dns/subdomain.service';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TenantStatusEnum, DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { HttpException, HttpStatus } from '@nestjs/common';
import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('AwareTenantService', () => {
    let service: AwareTenantService;
    let tenantRepository: DeepMocked<TenantAwareRepository<TenantEntity>>;
    let filesService: DeepMocked<FilesService>;
    let eventEmitter: DeepMocked<EventEmitter2>;
    let kratosService: DeepMocked<KratosService>;
    let dnsVerificationService: DeepMocked<DnsVerificationService>;
    let subdomainService: DeepMocked<SubdomainService>;

    const mockTenant = Stubber.stubOne(TenantEntity, {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: TenantStatusEnum.ACTIVE,
        domainVerificationStatus: DomainVerificationStatusEnum.UNVERIFIED,
        members: [],
        invitations: []
    });

    const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        identityId: 'user-123',
        sub: 'user-123'
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AwareTenantService,
                {
                    provide: 'TenantAwareRepository_TenantEntity',
                    useValue: createMock<TenantAwareRepository<TenantEntity>>()
                },
                { provide: FilesService, useValue: createMock<FilesService>() },
                { provide: EventEmitter2, useValue: createMock<EventEmitter2>() },
                { provide: KratosService, useValue: createMock<KratosService>() },
                { provide: DnsVerificationService, useValue: createMock<DnsVerificationService>() },
                { provide: SubdomainService, useValue: createMock<SubdomainService>() }
            ]
        }).compile();

        service = module.get<AwareTenantService>(AwareTenantService);
        tenantRepository = module.get('TenantAwareRepository_TenantEntity');
        filesService = module.get(FilesService);
        eventEmitter = module.get(EventEmitter2);
        kratosService = module.get(KratosService);
        dnsVerificationService = module.get(DnsVerificationService);
        subdomainService = module.get(SubdomainService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('update', () => {
        it('should update basic tenant details', async () => {
            tenantRepository.findOneOrFailTenantContext
                .mockResolvedValueOnce(mockTenant)
                .mockResolvedValueOnce({ ...mockTenant, name: 'Updated Name' } as any);
            tenantRepository.save.mockResolvedValue({ ...mockTenant, name: 'Updated Name' } as any);

            const result = await service.update('tenant-123', { name: 'Updated Name' }, mockUser);

            expect(result.name).toBe('Updated Name');
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.updated', expect.anything());
        });

        it('should handle logo upload', async () => {
            const mockFile = { buffer: Buffer.from('test') } as any;
            const mockUploadedImage = { id: 'image-123', url: 'http://image.url' };
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            filesService.uploadFile.mockResolvedValue(mockUploadedImage as any);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.update('tenant-123', {}, mockUser, mockFile);

            expect(filesService.uploadFile).toHaveBeenCalledWith(mockFile);
            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    image: mockUploadedImage
                })
            );
        });

        it('should handle subdomain (slug) update', async () => {
            const newSlug = 'new-slug';
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            subdomainService.isSubdomainAvailable.mockResolvedValue(true);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.update('tenant-123', { slug: newSlug }, mockUser);

            expect(subdomainService.validateSubdomain).toHaveBeenCalledWith(newSlug);
            expect(subdomainService.isSubdomainAvailable).toHaveBeenCalledWith(newSlug);
            expect(subdomainService.reserveSubdomain).toHaveBeenCalledWith(mockTenant.slug, 'tenant-123', 7);
            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    slug: newSlug
                })
            );
        });

        it('should throw error if subdomain is taken', async () => {
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            subdomainService.isSubdomainAvailable.mockResolvedValue(false);

            await expect(service.update('tenant-123', { slug: 'taken' }, mockUser)).rejects.toThrow(
                new HttpException('Subdomain is already taken', HttpStatus.CONFLICT)
            );
        });

        it('should handle custom domain update', async () => {
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.update('tenant-123', { customDomain: 'new.com' }, mockUser);

            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    customDomain: 'new.com',
                    domainVerificationStatus: DomainVerificationStatusEnum.PENDING,
                    domainVerificationToken: expect.stringContaining('pulse-verification-')
                })
            );
        });

        it('should emit tenant.updated event with correct payload', async () => {
            tenantRepository.findOneOrFailTenantContext
                .mockResolvedValueOnce(mockTenant)
                .mockResolvedValueOnce({ ...mockTenant, name: 'Updated' } as any);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.update('tenant-123', { name: 'Updated' }, mockUser, undefined, '127.0.0.1');

            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.updated', {
                tenant: expect.objectContaining({ name: 'Updated' }),
                oldTenant: mockTenant,
                changes: { name: 'Updated' },
                userId: mockUser.id,
                userEmail: mockUser.email,
                ipAddress: '127.0.0.1'
            });
        });
    });

    describe('verifyCustomDomain', () => {
        it('should verify domain successfully', async () => {
            const tenantWithDomain = {
                ...mockTenant,
                customDomain: 'verified.com',
                domainVerificationToken: 'token-123'
            } as TenantEntity;

            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(tenantWithDomain);
            dnsVerificationService.verifyTxtRecord.mockResolvedValue(true);
            tenantRepository.save.mockResolvedValue({ ...tenantWithDomain, domainVerificationStatus: DomainVerificationStatusEnum.VERIFIED } as any);

            const result = await service.verifyCustomDomain('tenant-123');

            expect(result.domainVerificationStatus).toBe(DomainVerificationStatusEnum.VERIFIED);
            expect(dnsVerificationService.verifyTxtRecord).toHaveBeenCalledWith('verified.com', 'token-123');
        });

        it('should throw error if verification fails', async () => {
            const tenantWithDomain = {
                ...mockTenant,
                customDomain: 'failed.com',
                domainVerificationToken: 'token-123'
            } as TenantEntity;

            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(tenantWithDomain);
            dnsVerificationService.verifyTxtRecord.mockResolvedValue(false);

            await expect(service.verifyCustomDomain('tenant-123')).rejects.toThrow(HttpException);
            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    domainVerificationStatus: DomainVerificationStatusEnum.FAILED
                })
            );
        });
    });

    describe('scheduleDeletion', () => {
        it('should schedule deletion successfully', async () => {
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            const result = await service.scheduleDeletion(
                'tenant-123',
                { password: 'valid-password', reason: 'leaving' },
                mockUser.id,
                'identity-123'
            );

            expect(result.scheduledAt).toBeDefined();
            expect(result.executionDate).toBeDefined();
            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: TenantStatusEnum.DELETION_SCHEDULED,
                    deletionReason: 'leaving'
                })
            );
        });

        it('should reject invalid password', async () => {
            kratosService.verifyPassword.mockResolvedValue(false);

            await expect(
                service.scheduleDeletion('tenant-123', { password: 'wrong', reason: 'leaving' }, mockUser.id, 'identity-123')
            ).rejects.toThrow(HttpException);
        });
    });

    describe('getTenantProfileStatistics', () => {
        it('should aggregate statistics correctly', async () => {
            const mockRawResult = {
                memberCount: '5',
                pendingInvitationCount: '2',
                activeApiKeyCount: '3'
            };

            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                addSelect: jest.fn().mockReturnThis(),
                getRawOne: jest.fn<any>().mockResolvedValue(mockRawResult)
            };

            (tenantRepository.manager.createQueryBuilder as any).mockReturnValue(mockQueryBuilder);

            const result = await service.getTenantProfileStatistics('tenant-123');

            expect(result).toEqual({
                memberCount: 5,
                pendingInvitationCount: 2,
                activeApiKeyCount: 3
            });
        });
    });

    describe('getProfile', () => {
        it('should return tenant profile with statistics', async () => {
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            jest.spyOn(service, 'getTenantProfileStatistics').mockResolvedValue({
                memberCount: 5,
                pendingInvitationCount: 2,
                activeApiKeyCount: 3
            });

            const result = await service.getProfile('tenant-123');

            expect(result.id).toBe(mockTenant.id);
            expect(result.memberCount).toBe(5);
            expect(result.pendingInvitationCount).toBe(2);
            expect(result.activeApiKeyCount).toBe(3);
        });
    });
});
