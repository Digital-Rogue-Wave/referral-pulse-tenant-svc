import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AllowServices } from '@common/auth/require-permission.decorator';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { TenantStatus } from '@domains/tenant/tenant.types';

import { DatabaseService } from '@app/database/database.service';
import { InternalTenantBillingStatusDto } from '@domains/billing';

@ApiTags('Internal')
@ApiBearerAuth()
@Controller('internal/tenants')
export class InternalTenantStatusController {
    constructor(private readonly prisma: DatabaseService) {}

    @ApiOkResponse({ type: InternalTenantBillingStatusDto })
    @AllowServices(ServiceCapability.TENANT_STATUS_READ)
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
            tenantStatus: tenant.status as TenantStatus,
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
