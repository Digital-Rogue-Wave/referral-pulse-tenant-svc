import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isEmail } from 'class-validator';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { DatabaseService } from '@app/database/database.service';
import { ContactQueryDto, OperatorContactResponse, TenantCommunicationProfileResponse } from '@domains/user/contact.dto';

type ContactRow = { id: string; tenantId: string; email: string; name: string | null; role: string };

const LIVE = { deletedAt: null, status: 'active' } as const;
const SELECT = { id: true, tenantId: true, email: true, name: true, role: true } as const;

/**
 * Operator contact and tenant communication-profile lookup for notification-service (decision X-3: addresses are resolved at send time, never
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

    @ApiOperation({ summary: 'Brand, locale, client-app link and reply-to used when mailing on the tenant’s behalf' })
    @ApiOkResponse({ type: TenantCommunicationProfileResponse })
    @AllowServices(ServiceCapability.TENANT_CONTACTS_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':tenantId/profile')
    async profileOf(@Param('tenantId') tenantId: string): Promise<TenantCommunicationProfileResponse> {
        const tenant = await this.prisma.tenant.findFirst({
            where: { id: tenantId, deletedAt: null },
            select: { id: true, name: true, status: true, setting: { select: { general: true } } }
        });
        if (!tenant) {
            throw new NotFoundException(`Tenant not found: ${tenantId}`);
        }
        const general = (tenant.setting?.general ?? {}) as Record<string, unknown>;
        return {
            tenantId: tenant.id,
            name: tenant.name,
            status: tenant.status,
            locale: canonicalLocale(general.locale),
            appUrl: httpsUrl(general.appUrl),
            replyTo: typeof general.supportEmail === 'string' && isEmail(general.supportEmail) ? general.supportEmail : null
        };
    }
}

/** A valid BCP 47 tag in canonical form (`de-de` → `de-DE`), or null. */
function canonicalLocale(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    try {
        return Intl.getCanonicalLocales(value)[0] ?? null;
    } catch {
        return null;
    }
}

function httpsUrl(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    try {
        return new URL(value).protocol === 'https:' ? value : null;
    } catch {
        return null;
    }
}

const toContact = (user: ContactRow): OperatorContactResponse => ({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role.toLowerCase()
});
