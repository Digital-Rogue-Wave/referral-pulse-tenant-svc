import { ApiProperty } from '@nestjs/swagger';

export class PaymentMethodSetupResponseDto {
    @ApiProperty()
    clientSecret!: string;

    @ApiProperty()
    customerId!: string;
}
