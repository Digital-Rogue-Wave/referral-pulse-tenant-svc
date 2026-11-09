import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type { PlanProps } from '../billing.types';
import { PlanDto } from '../dto/plan.dto';

export class PlanResponseMapper extends BaseResponseMapper<PlanProps, PlanDto> {
    constructor() {
        super(PlanDto);
    }

    /** US1.8.1 F5: the price the Stripe sync stored on the plan, as a first-class field. */
    override toResponse(entity: PlanProps): PlanDto {
        const response = super.toResponse(entity);
        response.price = priceOf(entity.metadata);
        return response;
    }
}

function priceOf(metadata: unknown): { amount: number; currency: string } | null {
    const price = (metadata as { price?: { amount?: unknown; currency?: unknown } } | null)?.price;
    return typeof price?.amount === 'number' && typeof price.currency === 'string' ? { amount: price.amount, currency: price.currency } : null;
}

export const planResponseMapper = new PlanResponseMapper();
