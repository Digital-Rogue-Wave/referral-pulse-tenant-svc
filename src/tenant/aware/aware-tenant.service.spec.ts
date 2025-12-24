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
import { getQueueToken } from '@nestjs/bullmq';
import { TENANT_UNLOCK_QUEUE } from '@mod/common/bullmq/queues/tenant-unlock.queue';
import { AuditService } from '@mod/common/audit/audit.service';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { TransferOwnershipDto } from '../dto/transfer-ownership.dto';

describe('AwareTenantService', () => {
    let service: AwareTenantService;
    let tenantRepository: DeepMocked<TenantAwareRepository<TenantEntity>>;
    let filesService: DeepMocked<FilesService>;
    let eventEmitter: DeepMocked<EventEmitter2>;
    let kratosService: DeepMocked<KratosService>;
    let dnsVerificationService: DeepMocked<DnsVerificationService>;
    let subdomainService: DeepMocked<SubdomainService>;
    let unlockQueue: DeepMocked<any>;
    let auditService: DeepMocked<AuditService>;

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
                { provide: SubdomainService, useValue: createMock<SubdomainService>() },
                {
                    provide: getQueueToken(TENANT_UNLOCK_QUEUE),
                    useValue: createMock<any>()
                },
                { provide: AuditService, useValue: createMock<AuditService>() }
            ]
        }).compile();

        service = module.get<AwareTenantService>(AwareTenantService);
        tenantRepository = module.get('TenantAwareRepository_TenantEntity');
        filesService = module.get(FilesService);
        eventEmitter = module.get(EventEmitter2);
        kratosService = module.get(KratosService);
        dnsVerificationService = module.get(DnsVerificationService);
        subdomainService = module.get(SubdomainService);
        subdomainService = module.get(SubdomainService);
        unlockQueue = module.get(getQueueToken(TENANT_UNLOCK_QUEUE));
        auditService = module.get(AuditService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('update', () => {
        it('should update basic tenant details', async () => {
            tenantRepository.findOneOrFailTenantContext
                .mockResolvedValueOnce(mockTenant)
                .mockResolvedValueOnce(Stubber.stubOne(TenantEntity, { ...mockTenant, name: 'Updated Name' }));
            tenantRepository.save.mockResolvedValue(Stubber.stubOne(TenantEntity, { ...mockTenant, name: 'Updated Name' }) as any);

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
                .mockResolvedValueOnce(Stubber.stubOne(TenantEntity, { ...mockTenant, name: 'Updated' }));
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
            const tenantWithDomain = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                customDomain: 'verified.com',
                domainVerificationToken: 'token-123'
            });

            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(tenantWithDomain);
            dnsVerificationService.verifyTxtRecord.mockResolvedValue(true);
            tenantRepository.save.mockResolvedValue(
                Stubber.stubOne(TenantEntity, { ...tenantWithDomain, domainVerificationStatus: DomainVerificationStatusEnum.VERIFIED }) as any
            );

            const result = await service.verifyCustomDomain('tenant-123');

            expect(result.domainVerificationStatus).toBe(DomainVerificationStatusEnum.VERIFIED);
            expect(dnsVerificationService.verifyTxtRecord).toHaveBeenCalledWith('verified.com', 'token-123');
        });

        it('should throw error if verification fails', async () => {
            const tenantWithDomain = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                customDomain: 'failed.com',
                domainVerificationToken: 'token-123'
            });

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

            const result = await service.scheduleDeletion('tenant-123', { password: 'valid-password', reason: 'leaving' }, mockUser);

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

            await expect(service.scheduleDeletion('tenant-123', { password: 'wrong', reason: 'leaving' }, mockUser)).rejects.toThrow(HttpException);
        });
    });

    describe('cancelDeletion', () => {
        it('should cancel scheduled deletion', async () => {
            const scheduledTenant = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: new Date()
            });
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(scheduledTenant);
            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.cancelDeletion('tenant-123', { password: 'valid' }, mockUser);

            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: TenantStatusEnum.ACTIVE,
                    deletionScheduledAt: undefined
                })
            );
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deletion.cancelled', expect.anything());
        });
    });

    describe('executeDeletion', () => {
        it('should perform hard delete', async () => {
            const scheduledAt = new Date();
            scheduledAt.setDate(scheduledAt.getDate() - 31); // 31 days ago

            const scheduledTenant = Stubber.stubOne(TenantEntity, {
                ...mockTenant,
                status: TenantStatusEnum.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledAt
            });
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(scheduledTenant);
            tenantRepository.remove.mockResolvedValue({} as any);

            await service.executeDeletion('tenant-123');

            expect(tenantRepository.delete).toHaveBeenCalledWith('tenant-123');
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.deleted', expect.anything());
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

    describe('lock', () => {
        it('should lock tenant and schedule job', async () => {
            const lockUntil = new Date();
            lockUntil.setDate(lockUntil.getDate() + 1);

            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);
            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.lock('tenant-123', { password: 'valid', reason: 'locked', lockUntil }, mockUser.id, mockUser.identityId);

            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: TenantStatusEnum.LOCKED,
                    lockReason: 'locked',
                    lockUntil
                })
            );
            expect(unlockQueue.add).toHaveBeenCalledWith('auto-unlock', expect.anything(), expect.anything());
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.locked', expect.anything());
        });

        it('should throw error if already locked', async () => {
            const lockedTenant = Stubber.stubOne(TenantEntity, { ...mockTenant, status: TenantStatusEnum.LOCKED });
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(lockedTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            await expect(service.lock('tenant-123', { password: 'valid' }, mockUser.id, mockUser.identityId)).rejects.toThrow(HttpException);
        });
    });

    describe('unlock', () => {
        it('should unlock tenant', async () => {
            const lockedTenant = Stubber.stubOne(TenantEntity, { ...mockTenant, status: TenantStatusEnum.LOCKED });
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(lockedTenant);
            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.unlock('tenant-123', { password: 'valid' }, mockUser.id, mockUser.identityId);

            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: TenantStatusEnum.ACTIVE,
                    lockedAt: undefined
                })
            );
            expect(eventEmitter.emit).toHaveBeenCalledWith('tenant.unlocked', expect.anything());
        });
    });

    describe('autoUnlock', () => {
        it('should automatically unlock tenant', async () => {
            const lockedTenant = Stubber.stubOne(TenantEntity, { ...mockTenant, status: TenantStatusEnum.LOCKED });
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(lockedTenant);
            tenantRepository.save.mockImplementation((entity) => entity as any);

            await service.autoUnlock('tenant-123');

            expect(tenantRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: TenantStatusEnum.ACTIVE
                })
            );
        });
    });
    describe('transferOwnership', () => {
        const dto: TransferOwnershipDto = {
            newOwnerId: 'new-owner-123',
            password: 'valid-password'
        };

        it('should transfer ownership successfully', async () => {
            kratosService.verifyPassword.mockResolvedValue(true);
            tenantRepository.findOneOrFailTenantContext.mockResolvedValue(mockTenant);

            await service.transferOwnership('tenant-123', dto, mockUser);

            expect(kratosService.verifyPassword).toHaveBeenCalledWith(mockUser.identityId, dto.password);
            expect(auditService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.OWNERSHIP_TRANSFERRED,
                    userId: mockUser.id,
                    tenantId: 'tenant-123'
                })
            );
            expect(eventEmitter.emit).toHaveBeenCalledWith(
                'ownership.transferred',
                expect.objectContaining({
                    tenantId: 'tenant-123',
                    oldOwnerId: mockUser.id,
                    newOwnerId: dto.newOwnerId
                })
            );
        });

        it('should throw error if password is invalid', async () => {
            kratosService.verifyPassword.mockResolvedValue(false);

            await expect(service.transferOwnership('tenant-123', dto, mockUser)).rejects.toThrow(HttpException);

            expect(auditService.log).not.toHaveBeenCalled();
            expect(eventEmitter.emit).not.toHaveBeenCalled();
        });
    });
});
