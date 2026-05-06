import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type { PlanProps } from '../billing.types';
import { PlanDto } from '../dto/plan.dto';

export class PlanResponseMapper extends BaseResponseMapper<PlanProps, PlanDto> {
    constructor() {
        super(PlanDto);
    }
}

export const planResponseMapper = new PlanResponseMapper();
