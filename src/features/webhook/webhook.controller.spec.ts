import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { TenantService } from '../tenant/tenant.service';
import { BillingService } from '../billing/billing.service';

import { WebhookController } from './webhook.controller';

describe('WebhookController.handleOryLogin', () => {
    let controller: WebhookController;
    let prisma: MockProxy<DatabaseService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;
    let configService: MockProxy<ConfigService>;

    const apiKey = 'ory-secret';

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        txEventEmitter = mock<TransactionEventEmitterService>();
        configService = mock<ConfigService>();

        prisma.user = { findFirst: jest.fn() } as never;
        configService.getOrThrow.mockReturnValue(apiKey);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WebhookController,
                { provide: TenantService, useValue: mock<TenantService>() },
                { provide: ConfigService, useValue: configService },
                { provide: BillingService, useValue: mock<BillingService>() },
                { provide: DatabaseService, useValue: prisma },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter }
            ]
        }).compile();

        controller = module.get(WebhookController);
    });

    it('emits user.logged_in for a resolved platform user', async () => {
        (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });

        const result = await controller.handleOryLogin(apiKey, { identity: { id: 'kratos-1' }, authentication_method: 'password' });

        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { kratosIdentityId: 'kratos-1', deletedAt: null } });
        expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith(
            'user.logged_in',
            expect.objectContaining({ aggregateId: 'user-1', tenantId: 'tenant-1', authMethod: 'password' })
        );
        expect(result).toEqual({ status: 'ok' });
    });

    it('rejects an invalid Ory webhook api key', async () => {
        await expect(controller.handleOryLogin('wrong', { identity: { id: 'kratos-1' } })).rejects.toBeInstanceOf(UnauthorizedException);
        expect(txEventEmitter.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('does not emit when the identity has no platform user', async () => {
        (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

        await controller.handleOryLogin(apiKey, { identity: { id: 'kratos-unknown' } });

        expect(txEventEmitter.emitAfterCommit).not.toHaveBeenCalled();
    });
});
