import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentMethodDto {
    @ApiProperty()
    id!: string;

    @ApiPropertyOptional({ nullable: true })
    brand!: string | null;

    @ApiPropertyOptional({ nullable: true })
    last4!: string | null;

    @ApiPropertyOptional({ nullable: true })
    expMonth!: number | null;

    @ApiPropertyOptional({ nullable: true })
    expYear!: number | null;

    @ApiProperty()
    isDefault!: boolean;
}
