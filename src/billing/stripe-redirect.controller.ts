import { Controller, Get } from '@nestjs/common';
import { Public } from '@mod/common/auth/jwt-auth.guard';

@Controller()
@Public()
export class StripeRedirectController {
    @Get('success')
    success() {
        return {
            ok: true,
            message: 'Stripe checkout completed successfully'
        };
    }

    @Get('cancel')
    cancel() {
        return {
            ok: true,
            message: 'Stripe checkout cancelled'
        };
    }
}
