import { ApiProperty } from '@nestjs/swagger';

export class PaymentMethodDto {
    @ApiProperty({ description: 'Stripe payment method id' })
    id: string;

    @ApiProperty({ description: 'Card brand, e.g. visa', nullable: true })
    brand: string | null;

    @ApiProperty({ description: 'Last 4 digits of the card', nullable: true })
    last4: string | null;

    @ApiProperty({ description: 'Card expiration month', nullable: true })
    expMonth: number | null;

    @ApiProperty({ description: 'Card expiration year', nullable: true })
    expYear: number | null;

    @ApiProperty({ description: 'Whether this payment method is the customer default payment method' })
    isDefault: boolean;
}
