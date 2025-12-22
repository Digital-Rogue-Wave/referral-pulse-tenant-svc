import { Injectable, Logger } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PlanService } from './plan.service';

@Injectable()
export class PlanStripeSyncService {
    private readonly logger = new Logger(PlanStripeSyncService.name);

    constructor(
        private readonly stripeService: StripeService,
        private readonly planService: PlanService
    ) {}

    async syncFromStripe(): Promise<void> {
        this.logger.log('Stripe plan sync not implemented yet');
    }
}
