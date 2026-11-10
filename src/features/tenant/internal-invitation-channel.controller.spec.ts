import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { SERVICE_CAPABILITIES_KEY } from '@common/auth/require-permission.decorator';
import { DatabaseService } from '@app/database/database.service';

import { InternalInvitationChannelController } from './internal-invitation-channel.controller';

describe('InternalInvitationChannelController', () => {
    const prisma = { tenant: { findFirst: jest.fn() } };
    const controller = new InternalInvitationChannelController(prisma as unknown as DatabaseService);

    beforeEach(() => prisma.tenant.findFirst.mockReset());

    it('gives the Owner’s explicit choice', async () => {
        prisma.tenant.findFirst.mockResolvedValue({ id: 't1', invitationChannel: 'forbidden', billingCountry: 'FR' });

        await expect(controller.invitationChannelOf('t1')).resolves.toEqual({ tenantId: 't1', invitationChannel: 'forbidden' });
    });

    it('gives the jurisdiction default when the Owner made no choice: a German tenant is forbidden', async () => {
        prisma.tenant.findFirst.mockResolvedValue({ id: 't1', invitationChannel: null, billingCountry: 'DE' });

        await expect(controller.invitationChannelOf('t1')).resolves.toEqual({ tenantId: 't1', invitationChannel: 'forbidden' });
    });

    it('reads only live tenants and only the two columns the rule needs', async () => {
        prisma.tenant.findFirst.mockResolvedValue({ id: 't1', invitationChannel: null, billingCountry: 'FR' });

        await controller.invitationChannelOf('t1');

        expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
            where: { id: 't1', deletedAt: null },
            select: { id: true, invitationChannel: true, billingCountry: true }
        });
    });

    it('is 404 for an unknown or deleted tenant', async () => {
        prisma.tenant.findFirst.mockResolvedValue(null);

        await expect(controller.invitationChannelOf('gone')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is service-only, under its own capability rather than the contacts grant', () => {
        const capabilities = new Reflector().get<ServiceCapability[]>(SERVICE_CAPABILITIES_KEY, controller.invitationChannelOf);

        expect(capabilities).toEqual([ServiceCapability.TENANT_INVITATION_CHANNEL_READ]);
    });
});
