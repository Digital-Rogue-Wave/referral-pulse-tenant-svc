import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { BillingEntity } from './billing.entity';
import { InternalTenantBillingStatusDto } from './dto/internal-tenant-billing-status.dto';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/billing.enum';

@ApiTags('Internal')
@ApiBearerAuth()
@Controller('internal/tenants')
export class InternalTenantStatusController {
    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        @InjectRepository(BillingEntity)
        private readonly billingRepository: Repository<BillingEntity>
    ) {}

    @ApiOkResponse({ type: InternalTenantBillingStatusDto })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.READ,
        objectParam: 'id',
        allowServiceTokens: true
    })
    @HttpCode(HttpStatus.OK)
    @Get(':id/status')
    async getTenantStatus(@Param('id') tenantId: string): Promise<InternalTenantBillingStatusDto> {
        const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });

        if (!tenant) {
            throw new NotFoundException({
                message: `Tenant not found: ${tenantId}`,
                code: HttpStatus.NOT_FOUND
            });
        }

        const billing = await this.billingRepository.findOne({ where: { tenantId } });

        return {
            tenantId,
            tenantStatus: tenant.status,
            paymentStatus: tenant.paymentStatus,
            trialStartedAt: tenant.trialStartedAt ?? null,
            trialEndsAt: tenant.trialEndsAt ?? null,
            plan: billing?.plan ?? BillingPlanEnum.FREE,
            subscriptionStatus: billing?.status ?? SubscriptionStatusEnum.NONE,
            stripeCustomerId: billing?.stripeCustomerId ?? null,
            stripeSubscriptionId: billing?.stripeSubscriptionId ?? null
        };
    }
}
