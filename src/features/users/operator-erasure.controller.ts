import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { ErasureReceiptResponse, OperatorErasureDto } from '@domains/erasure';
import { DomainMetrics } from '@common/monitoring/domain-metrics.service';

import { OperatorErasureService } from './operator-erasure.service';

/**
 * Identity's step of the data-subject erasure fan-out (Product Spec v4 "DSR Propagation"). Called by the
 * compliance orchestrator's workflow activity with a client-credentials token holding `dsr.erase`; the
 * response is this service's receipt for `erasure.completed`.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/erasures', version: '1' })
export class OperatorErasureController {
    constructor(
        private readonly erasure: OperatorErasureService,
        private readonly domainMetrics: DomainMetrics
    ) {}

    @ApiOperation({ summary: 'Erase an operator (data subject) from tenant-service and return the receipt' })
    @ApiOkResponse({ type: ErasureReceiptResponse })
    @AllowServices(ServiceCapability.DSR_ERASE)
    @HttpCode(HttpStatus.OK)
    @Post('operators')
    async eraseOperator(@Body() dto: OperatorErasureDto): Promise<ErasureReceiptResponse> {
        const receipt = await this.erasure.erase(dto);
        this.domainMetrics.erasure(receipt.status);
        return receipt;
    }
}
