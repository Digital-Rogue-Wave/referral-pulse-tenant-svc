import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { DatabaseService } from '@app/database/database.service';
import { ContactQueryDto, OperatorContactResponse } from '@domains/user/contact.dto';

type ContactRow = { id: string; tenantId: string; email: string; name: string | null; role: string };

const LIVE = { deletedAt: null, status: 'active' } as const;
const SELECT = { id: true, tenantId: true, email: true, name: true, role: true } as const;

/**
 * Operator contact lookup for notification-service (decision X-3: addresses are resolved at send time, never
 * carried in events). Service-only: `tenant_contacts.read`.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/tenants', version: '1' })
export class OperatorContactController {
    constructor(private readonly prisma: DatabaseService) {}

    @ApiOperation({ summary: 'Contact of one live operator of the tenant' })
    @ApiOkResponse({ type: OperatorContactResponse })
    @AllowServices(ServiceCapability.TENANT_CONTACTS_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':tenantId/users/:userId/contact')
    async contactOf(@Param('tenantId') tenantId: string, @Param('userId') userId: string): Promise<OperatorContactResponse> {
        const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId, ...LIVE }, select: SELECT });
        if (!user) {
            throw new NotFoundException(`No live operator ${userId} in tenant ${tenantId}`);
        }
        return toContact(user);
    }

    @ApiOperation({ summary: 'Contacts of the tenant’s live operators, optionally of one role (e.g. the Owner for billing mail)' })
    @ApiOkResponse({ type: OperatorContactResponse, isArray: true })
    @AllowServices(ServiceCapability.TENANT_CONTACTS_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':tenantId/contacts')
    async contactsOf(@Param('tenantId') tenantId: string, @Query() query: ContactQueryDto): Promise<OperatorContactResponse[]> {
        const users = await this.prisma.user.findMany({
            where: { tenantId, ...LIVE, ...(query.role ? { role: query.role } : {}) },
            select: SELECT,
            orderBy: { createdAt: 'asc' },
            take: 100
        });
        return users.map(toContact);
    }
}

const toContact = (user: ContactRow): OperatorContactResponse => ({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role.toLowerCase()
});
