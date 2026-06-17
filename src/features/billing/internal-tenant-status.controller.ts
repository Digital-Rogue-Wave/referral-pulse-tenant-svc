import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation } from '@common/auth/keto.constants';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { TenantStatusEnum } from '@common/enums/tenant.enum';

import { DatabaseService } from '@app/database/database.service';
import { InternalTenantBillingStatusDto } from '@domains/billing';

@ApiTags('Internal')
@ApiBearerAuth()
@Controller('internal/tenants')
export class InternalTenantStatusController {
    constructor(private readonly prisma: DatabaseService) {}

    @ApiOkResponse({ type: InternalTenantBillingStatusDto })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ, allowServiceTokens: true })
    @HttpCode(HttpStatus.OK)
    @Get(':id/status')
    async getTenantStatus(@Param('id') tenantId: string): Promise<InternalTenantBillingStatusDto> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId }
        });

        if (!tenant) {
            throw new NotFoundException({
                message: `Tenant not found: ${tenantId}`,
                code: HttpStatus.NOT_FOUND
            });
        }

        const billing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });

        return {
            tenantId,
            tenantStatus: tenant.status as TenantStatusEnum,
            paymentStatus: tenant.paymentStatus as PaymentStatusEnum,
            trialStartedAt: tenant.trialStartedAt ?? null,
            trialEndsAt: tenant.trialEndsAt ?? null,
            plan: (billing?.plan as BillingPlanEnum) ?? BillingPlanEnum.FREE,
            subscriptionStatus: (billing?.status as SubscriptionStatusEnum) ?? SubscriptionStatusEnum.NONE,
            stripeCustomerId: billing?.stripeCustomerId ?? null,
            stripeSubscriptionId: billing?.stripeSubscriptionId ?? null
        };
    }
}
