import { ApiProperty } from '@nestjs/swagger';

export class PaymentMethodSetupResponseDto {
    @ApiProperty({
        description: 'Client secret of the Stripe SetupIntent used to attach a payment method to the customer'
    })
    clientSecret: string;

    @ApiProperty({
        description: 'Stripe customer id this SetupIntent is associated with'
    })
    customerId: string;
}
