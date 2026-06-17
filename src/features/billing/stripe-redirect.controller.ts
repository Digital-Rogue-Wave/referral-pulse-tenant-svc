import { Controller, Get } from '@nestjs/common';
import { Public } from '@common/auth/public.decorator';

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
