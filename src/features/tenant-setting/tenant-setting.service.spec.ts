import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { TenantSettingService } from './tenant-setting.service';

describe('TenantSettingService', () => {
    let service: TenantSettingService;
    let prisma: MockProxy<DatabaseService>;
    let tenantContext: MockProxy<TenantContextService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;

    const tenantId = 'tenant-123';
    const existing = {
        id: 'set-1',
        tenantId,
        branding: { a: 1 },
        notifications: {},
        general: {},
        currencyCode: 'USD',
        createdAt: new Date(),
        updatedAt: new Date()
    };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        tenantContext = mock<TenantContextService>();
        txEventEmitter = mock<TransactionEventEmitterService>();

        prisma.tenantSetting = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } as never;
        tenantContext.getTenantId.mockReturnValue(tenantId);
        tenantContext.getUserId.mockReturnValue('user-1');

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantSettingService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantContextService, useValue: tenantContext },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() }
            ]
        }).compile();

        service = module.get(TenantSettingService);
    });

    it('creates settings and emits tenant-setting.created when none exist', async () => {
        (prisma.tenantSetting.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.tenantSetting.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...existing, ...data })
        );

        await service.upsert({ branding: { x: 1 } });

        expect(prisma.tenantSetting.create).toHaveBeenCalled();
        expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith('tenant-setting.created', expect.anything());
    });

    it('updates settings (by tenantId) and emits tenant-setting.updated when one exists', async () => {
        (prisma.tenantSetting.findUnique as jest.Mock).mockResolvedValue(existing);
        (prisma.tenantSetting.update as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...existing, ...data })
        );

        await service.upsert({ currencyCode: 'EUR' });

        const updateArg = (prisma.tenantSetting.update as jest.Mock).mock.calls[0][0];
        expect(updateArg.where).toEqual({ tenantId });
        expect(updateArg.data.currencyCode).toBe('EUR');
        expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith('tenant-setting.updated', expect.anything());
    });

    it('findByTenant returns null when settings are not initialised', async () => {
        (prisma.tenantSetting.findUnique as jest.Mock).mockResolvedValue(null);
        expect(await service.findByTenant()).toBeNull();
    });
});
