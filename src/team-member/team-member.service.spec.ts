import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TeamMemberService } from './team-member.service';
import { TeamMemberEntity } from './team-member.entity';
import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { RoleEnum } from '@mod/common/enums/role.enum';
import Stubber from '@mod/common/mock/typeorm-faker';

import { AuditService } from '@mod/common/audit/audit.service';
import { ClsService } from 'nestjs-cls';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { BadRequestException } from '@nestjs/common';

describe('TeamMemberService', () => {
    let service: TeamMemberService;
    let repository: DeepMocked<TenantAwareRepository<TeamMemberEntity>>;
    let eventEmitter: DeepMocked<EventEmitter2>;
    let auditService: DeepMocked<AuditService>;
    let clsService: DeepMocked<ClsService>;

    const memberId = 'member-123';
    const userId = 'user-123';
    const tenantId = 'tenant-123';

    beforeEach(async () => {
        repository = createMock<TenantAwareRepository<TeamMemberEntity>>();
        eventEmitter = createMock<EventEmitter2>();
        auditService = createMock<AuditService>();
        clsService = createMock<ClsService>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TeamMemberService,
                {
                    provide: 'TenantAwareRepository_TeamMemberEntity',
                    useValue: repository
                },
                {
                    provide: EventEmitter2,
                    useValue: eventEmitter
                },
                {
                    provide: AuditService,
                    useValue: auditService
                },
                {
                    provide: ClsService,
                    useValue: clsService
                }
            ]
        }).compile();

        service = module.get<TeamMemberService>(TeamMemberService);
    });

    describe('create', () => {
        it('should create and save a team member', async () => {
            const createDto = { userId, tenantId, role: RoleEnum.MEMBER };
            const member = Stubber.stubOne(TeamMemberEntity, { ...createDto, id: memberId });
            repository.createTenantContext.mockReturnValue(member);
            repository.saveTenantContext.mockResolvedValue(member);

            const result = await service.create(createDto);

            expect(result).toEqual(member);
            expect(repository.createTenantContext).toHaveBeenCalledWith(createDto);
            expect(repository.saveTenantContext).toHaveBeenCalledWith(member);
        });
    });

    describe('findAll', () => {
        it('should return paginated team members', async () => {
            const query = {} as any;
            const paginatedResult = { data: [], meta: {} } as any;
            repository.paginateTenantContext.mockResolvedValue(paginatedResult);

            const result = await service.findAll(query);

            expect(result).toBe(paginatedResult);
            expect(repository.paginateTenantContext).toHaveBeenCalled();
        });
    });

    describe('updateRole', () => {
        it('should update the role, emit event and log audit', async () => {
            const member = Stubber.stubOne(TeamMemberEntity, { id: memberId, userId, tenantId, role: RoleEnum.MEMBER });
            repository.findOneOrFail.mockResolvedValue(member);
            repository.saveTenantContext.mockImplementation(async (m) => await (m as TeamMemberEntity));
            clsService.get.mockReturnValue({ userId: 'admin-123', ip: '1.2.3.4', userAgent: 'test-ua' });

            const result = await service.updateRole(memberId, { role: RoleEnum.ADMIN });

            expect(result.role).toBe(RoleEnum.ADMIN);
            expect(auditService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.MEMBER_ROLE_UPDATED,
                    tenantId: tenantId
                })
            );
            expect(eventEmitter.emit).toHaveBeenCalledWith(
                'member.role.updated',
                expect.objectContaining({
                    memberId,
                    oldRole: RoleEnum.MEMBER,
                    newRole: RoleEnum.ADMIN
                })
            );
        });

        it('should throw error if attempting to downgrade the last admin', async () => {
            const member = Stubber.stubOne(TeamMemberEntity, { id: memberId, userId, role: RoleEnum.ADMIN });
            repository.findOneOrFail.mockResolvedValue(member);
            repository.getTotalTenantContext.mockResolvedValue(1); // Only 1 admin left

            await expect(service.updateRole(memberId, { role: RoleEnum.MEMBER })).rejects.toThrow(BadRequestException);
        });

        it('should not throw if there is another admin', async () => {
            const member = Stubber.stubOne(TeamMemberEntity, { id: memberId, userId, role: RoleEnum.ADMIN, tenantId });
            repository.findOneOrFail.mockResolvedValue(member);
            repository.getTotalTenantContext.mockResolvedValue(2); // Two admins
            repository.saveTenantContext.mockImplementation(async (m) => await (m as TeamMemberEntity));
            clsService.get.mockReturnValue({ userId: 'admin-123' });

            await expect(service.updateRole(memberId, { role: RoleEnum.MEMBER })).resolves.toBeDefined();
        });
    });

    describe('remove', () => {
        it('should remove the member, emit event and log audit', async () => {
            const member = Stubber.stubOne(TeamMemberEntity, { id: memberId, userId, tenantId, role: RoleEnum.MEMBER });
            repository.findOneOrFail.mockResolvedValue(member);
            repository.deleteTenantContext.mockResolvedValue({ affected: 1 } as any);
            clsService.get.mockReturnValue({ userId: 'admin-123' });

            await service.remove(memberId);

            expect(auditService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.MEMBER_REMOVED,
                    tenantId: tenantId
                })
            );
            expect(eventEmitter.emit).toHaveBeenCalledWith(
                'member.removed',
                expect.objectContaining({
                    memberId,
                    userId,
                    tenantId
                })
            );
            expect(repository.deleteTenantContext).toHaveBeenCalledWith({ id: memberId });
        });

        it('should throw error if attempting to remove the last admin', async () => {
            const member = Stubber.stubOne(TeamMemberEntity, { id: memberId, userId, role: RoleEnum.ADMIN });
            repository.findOneOrFail.mockResolvedValue(member);
            repository.getTotalTenantContext.mockResolvedValue(1); // Only 1 admin left

            await expect(service.remove(memberId)).rejects.toThrow(BadRequestException);
        });

        it('should not throw if there is another admin left', async () => {
            const member = Stubber.stubOne(TeamMemberEntity, { id: memberId, userId, role: RoleEnum.ADMIN, tenantId });
            repository.findOneOrFail.mockResolvedValue(member);
            repository.getTotalTenantContext.mockResolvedValue(2); // Two admins
            repository.deleteTenantContext.mockResolvedValue({ affected: 1 } as any);
            clsService.get.mockReturnValue({ userId: 'admin-123' });

            await expect(service.remove(memberId)).resolves.toBeDefined();
        });
    });
});
