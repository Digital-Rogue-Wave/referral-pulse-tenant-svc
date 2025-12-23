import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditLogEntity } from './audit-log.entity';
import { AuditAction } from './audit-action.enum';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('AuditService', () => {
    let service: AuditService;
    let repository: DeepMocked<Repository<AuditLogEntity>>;

    beforeEach(async () => {
        repository = createMock<Repository<AuditLogEntity>>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuditService,
                {
                    provide: getRepositoryToken(AuditLogEntity),
                    useValue: repository
                }
            ]
        }).compile();

        service = module.get<AuditService>(AuditService);
    });

    it('should log an entry', async () => {
        const dto = {
            tenantId: 'tenant-1',
            action: AuditAction.TENANT_UPDATED,
            userId: 'user-1'
        };
        const logEntity = Stubber.stubOne(AuditLogEntity, { id: 'uuid', ...dto });

        repository.create.mockReturnValue(logEntity);
        repository.save.mockResolvedValue(logEntity);

        const result = await service.log(dto);

        expect(result).toBe(logEntity);
        expect(repository.create).toHaveBeenCalledWith(dto);
        expect(repository.save).toHaveBeenCalledWith(logEntity);
    });

    it('should delete logs older than a date', async () => {
        const date = new Date();
        const executeMock = jest.fn(() => Promise.resolve({ affected: 5 }));
        const whereMock = jest.fn().mockReturnValue({ execute: executeMock });
        const deleteMock = jest.fn().mockReturnValue({ where: whereMock });

        repository.createQueryBuilder.mockReturnValue({
            delete: deleteMock
        } as any);

        const result = await service.deleteOlderThan(date);

        expect(result).toBe(5);
        expect(deleteMock).toHaveBeenCalled();
        expect(whereMock).toHaveBeenCalledWith('created_at < :date', { date });
    });
});
