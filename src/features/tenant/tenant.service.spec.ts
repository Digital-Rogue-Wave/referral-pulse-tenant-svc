import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { TenantService } from './tenant.service';
import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { KetoService } from '@common/auth/keto.service';
import { KratosService } from '@common/auth/kratos.service';
import { BullJobsService } from '@common/bulljobs';
import { SubdomainService } from '../dns/subdomain.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { FilesService } from '../files/files.service';
import { TenantStatus, DomainVerificationStatus, CreateTenantDto } from '@domains/tenant';

describe('TenantService', () => {
    let service: TenantService;
    let prisma: MockProxy<DatabaseService>;
    let logger: MockProxy<AppLoggerService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;
    let tenantContext: MockProxy<TenantContextService>;
    let configService: MockProxy<ConfigService>;
    let ketoService: MockProxy<KetoService>;
    let kratosService: MockProxy<KratosService>;
    let subdomainService: MockProxy<SubdomainService>;
    let dnsVerificationService: MockProxy<DnsVerificationService>;
    let filesService: MockProxy<FilesService>;
    let bullJobsService: MockProxy<BullJobsService>;

    const mockTenant = {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: TenantStatus.ACTIVE,
        paymentStatus: 'trial',
        domainVerificationStatus: DomainVerificationStatus.UNVERIFIED,
        trialStartedAt: new Date(),
        trialEndsAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
    };

    const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        identityId: 'identity-123',
        sub: 'user-123',
        tenantId: 'tenant-123',
    };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        logger = mock<AppLoggerService>();
        txEventEmitter = mock<TransactionEventEmitterService>();
        tenantContext = mock<TenantContextService>();
        configService = mock<ConfigService>();
        ketoService = mock<KetoService>();
        kratosService = mock<KratosService>();
        subdomainService = mock<SubdomainService>();
        dnsVerificationService = mock<DnsVerificationService>();
        filesService = mock<FilesService>();
        bullJobsService = mock<BullJobsService>();

        // Setup prisma mocks
        prisma.tenant = {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        } as any;
        prisma.tenantSetting = {
            create: jest.fn(),
        } as any;
        prisma.teamMember = {
            count: jest.fn(),
        } as any;
        prisma.invitation = {
            count: jest.fn(),
        } as any;
        prisma.apiKey = {
            count: jest.fn(),
        } as any;
        prisma.$transaction = jest.fn((cb) => cb(prisma));

        configService.get.mockReturnValue({ trialDurationDays: 14 });
        tenantContext.getTenantId.mockReturnValue('tenant-123');
        tenantContext.getUserId.mockReturnValue('user-123');

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantService,
                { provide: DatabaseService, useValue: prisma },
                { provide: AppLoggerService, useValue: logger },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: TenantContextService, useValue: tenantContext },
                { provide: ConfigService, useValue: configService },
                { provide: KetoService, useValue: ketoService },
                { provide: KratosService, useValue: kratosService },
                { provide: SubdomainService, useValue: subdomainService },
                { provide: DnsVerificationService, useValue: dnsVerificationService },
                { provide: FilesService, useValue: filesService },
                { provide: BullJobsService, useValue: bullJobsService },
            ],
        }).compile();

        service = module.get<TenantService>(TenantService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        const createDto: CreateTenantDto = {
            name: 'Test Tenant',
            slug: 'test-tenant',
            ownerId: 'owner-123',
        };

        it('should create a tenant successfully', async () => {
            subdomainService.validateSubdomain.mockReturnValue(undefined as any);
            subdomainService.isSubdomainAvailable.mockResolvedValue(true);
            (prisma.tenant.create as jest.Mock).mockResolvedValue(mockTenant);
            (prisma.tenantSetting.create as jest.Mock).mockResolvedValue({});

            const result = await service.create(createDto);

            expect(result).toBeDefined();
            expect(result.id).toBe(mockTenant.id);
            expect(subdomainService.validateSubdomain).toHaveBeenCalledWith(createDto.slug);
            expect(subdomainService.isSubdomainAvailable).toHaveBeenCalledWith(createDto.slug);
            expect(ketoService.createTuple).toHaveBeenCalledTimes(2);
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw error if subdomain is not available', async () => {
            subdomainService.validateSubdomain.mockReturnValue(undefined as any);
            subdomainService.isSubdomainAvailable.mockResolvedValue(false);

            await expect(service.create(createDto)).rejects.toThrow(HttpException);
        });

        it('should handle file upload if provided', async () => {
            const file = { buffer: Buffer.from('test') } as any;
            const uploadedFile = { id: 'file-123' };

            subdomainService.validateSubdomain.mockReturnValue(undefined as any);
            subdomainService.isSubdomainAvailable.mockResolvedValue(true);
            filesService.uploadFile.mockResolvedValue(uploadedFile as any);
            (prisma.tenant.create as jest.Mock).mockResolvedValue(mockTenant);

            await service.create(createDto, file);

            expect(filesService.uploadFile).toHaveBeenCalledWith(file);
        });
    });

    describe('findOneById', () => {
        it('should find a tenant by id', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);

            const result = await service.findOneById('tenant-123');

            expect(result).toEqual(mockTenant);
            expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
                where: { id: 'tenant-123', deletedAt: null },
            });
        });

        it('should return null if tenant not found', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await service.findOneById('non-existent');

            expect(result).toBeNull();
        });
    });

    describe('suspend', () => {
        it('should suspend a tenant successfully', async () => {
            const suspendedTenant = { ...mockTenant, status: TenantStatus.SUSPENDED };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
            (prisma.tenant.update as jest.Mock).mockResolvedValue(suspendedTenant);

            const result = await service.suspend('tenant-123', 'test reason', 'user-123');

            expect(result.status).toBe(TenantStatus.SUSPENDED);
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw if tenant not found', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

            await expect(service.suspend('non-existent')).rejects.toThrow(HttpException);
        });
    });

    describe('unsuspend', () => {
        it('should unsuspend a tenant successfully', async () => {
            const suspendedTenant = { ...mockTenant, status: TenantStatus.SUSPENDED };
            const activeTenant = { ...mockTenant, status: TenantStatus.ACTIVE };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(suspendedTenant);
            (prisma.tenant.update as jest.Mock).mockResolvedValue(activeTenant);

            const result = await service.unsuspend('tenant-123', 'user-123');

            expect(result.status).toBe(TenantStatus.ACTIVE);
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });
    });

    describe('getProfile', () => {
        it('should return tenant profile with statistics', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
            (prisma.teamMember.count as jest.Mock).mockResolvedValue(5);
            (prisma.invitation.count as jest.Mock).mockResolvedValue(2);
            (prisma.apiKey.count as jest.Mock).mockResolvedValue(3);

            const result = await service.getProfile();

            expect(result.id).toBe(mockTenant.id);
            expect(result.memberCount).toBe(5);
            expect(result.pendingInvitationCount).toBe(2);
            expect(result.activeApiKeyCount).toBe(3);
        });

        it('should throw if tenant not found', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

            await expect(service.getProfile()).rejects.toThrow(HttpException);
        });
    });

    describe('lock', () => {
        it('should lock tenant and schedule unlock job', async () => {
            const lockUntil = new Date();
            lockUntil.setDate(lockUntil.getDate() + 1);

            const lockedTenant = {
                ...mockTenant,
                status: TenantStatus.LOCKED,
                lockedAt: new Date(),
                lockUntil,
            };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
            (prisma.tenant.update as jest.Mock).mockResolvedValue(lockedTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            const result = await service.lock(
                {
                    password: 'valid',
                    reason: 'test',
                    lockUntil: lockUntil.toISOString(),
                },
                mockUser as any,
            );

            expect(result.status).toBe(TenantStatus.LOCKED);
            expect(bullJobsService.addDelayedJob).toHaveBeenCalled();
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw error if already locked', async () => {
            const lockedTenant = { ...mockTenant, status: TenantStatus.LOCKED };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(lockedTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            await expect(service.lock({ password: 'valid' }, mockUser as any)).rejects.toThrow(HttpException);
        });

        it('should throw error if password is invalid', async () => {
            kratosService.verifyPassword.mockResolvedValue(false);

            await expect(service.lock({ password: 'wrong' }, mockUser as any)).rejects.toThrow(HttpException);
        });
    });

    describe('unlock', () => {
        it('should unlock tenant', async () => {
            const lockedTenant = { ...mockTenant, status: TenantStatus.LOCKED };
            const unlockedTenant = { ...mockTenant, status: TenantStatus.ACTIVE };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(lockedTenant);
            (prisma.tenant.update as jest.Mock).mockResolvedValue(unlockedTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            const result = await service.unlock({ password: 'valid' }, mockUser as any);

            expect(result.status).toBe(TenantStatus.ACTIVE);
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw if tenant is not locked', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            await expect(service.unlock({ password: 'valid' }, mockUser as any)).rejects.toThrow(HttpException);
        });
    });

    describe('scheduleDeletion', () => {
        it('should schedule deletion successfully', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
            (prisma.tenant.update as jest.Mock).mockResolvedValue({
                ...mockTenant,
                status: TenantStatus.DELETION_SCHEDULED,
            });
            kratosService.verifyPassword.mockResolvedValue(true);

            const result = await service.scheduleDeletion({ password: 'valid', reason: 'leaving' }, mockUser as any);

            expect(result.scheduledAt).toBeDefined();
            expect(result.executionDate).toBeDefined();
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw error if already scheduled', async () => {
            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatus.DELETION_SCHEDULED,
            };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(scheduledTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            await expect(service.scheduleDeletion({ password: 'valid' }, mockUser as any)).rejects.toThrow(
                HttpException,
            );
        });
    });

    describe('cancelDeletion', () => {
        it('should cancel deletion successfully', async () => {
            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatus.DELETION_SCHEDULED,
                deletionScheduledAt: new Date(),
            };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(scheduledTenant);
            (prisma.tenant.update as jest.Mock).mockResolvedValue({
                ...mockTenant,
                status: TenantStatus.ACTIVE,
            });
            kratosService.verifyPassword.mockResolvedValue(true);

            await service.cancelDeletion({ password: 'valid' }, mockUser as any);

            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw error if not scheduled', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            await expect(service.cancelDeletion({ password: 'valid' }, mockUser as any)).rejects.toThrow(HttpException);
        });
    });

    describe('executeDeletion', () => {
        it('should execute deletion after 30 days', async () => {
            const scheduledDate = new Date();
            scheduledDate.setDate(scheduledDate.getDate() - 31);

            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatus.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledDate,
            };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(scheduledTenant);
            (prisma.tenant.delete as jest.Mock).mockResolvedValue(scheduledTenant);

            await service.executeDeletion('tenant-123');

            expect(prisma.tenant.delete).toHaveBeenCalledWith({
                where: { id: 'tenant-123' },
            });
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw error if 30 days have not passed', async () => {
            const scheduledDate = new Date();
            scheduledDate.setDate(scheduledDate.getDate() - 15);

            const scheduledTenant = {
                ...mockTenant,
                status: TenantStatus.DELETION_SCHEDULED,
                deletionScheduledAt: scheduledDate,
            };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(scheduledTenant);

            await expect(service.executeDeletion('tenant-123')).rejects.toThrow(HttpException);
        });
    });

    describe('verifyCustomDomain', () => {
        it('should verify domain successfully', async () => {
            const tenantWithDomain = {
                ...mockTenant,
                customDomain: 'custom.example.com',
                domainVerificationToken: 'token-123',
            };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(tenantWithDomain);
            dnsVerificationService.verifyTxtRecord.mockResolvedValue(true);
            (prisma.tenant.update as jest.Mock).mockResolvedValue({
                ...tenantWithDomain,
                domainVerificationStatus: DomainVerificationStatus.VERIFIED,
            });

            const result = await service.verifyCustomDomain();

            expect(result.domainVerificationStatus).toBe(DomainVerificationStatus.VERIFIED);
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw error if verification fails', async () => {
            const tenantWithDomain = {
                ...mockTenant,
                customDomain: 'failed.example.com',
                domainVerificationToken: 'token-123',
            };

            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(tenantWithDomain);
            dnsVerificationService.verifyTxtRecord.mockResolvedValue(false);

            await expect(service.verifyCustomDomain()).rejects.toThrow(HttpException);
        });
    });

    describe('transferOwnership', () => {
        it('should transfer ownership successfully', async () => {
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockTenant);
            kratosService.verifyPassword.mockResolvedValue(true);

            await service.transferOwnership({ newOwnerId: 'new-owner-123', password: 'valid' }, mockUser as any);

            expect(ketoService.deleteTuple).toHaveBeenCalled();
            expect(ketoService.createTuple).toHaveBeenCalled();
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalled();
        });

        it('should throw error if password is invalid', async () => {
            kratosService.verifyPassword.mockResolvedValue(false);

            await expect(
                service.transferOwnership({ newOwnerId: 'new-owner-123', password: 'wrong' }, mockUser as any),
            ).rejects.toThrow(HttpException);
        });
    });
});
