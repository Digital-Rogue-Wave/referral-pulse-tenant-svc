import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpcomingInvoiceDto {
    @ApiProperty({ description: 'Integer in minor units (cents), as Stripe sends it', example: 4900 })
    amountDue!: number;

    @ApiProperty({ description: 'ISO 4217, lowercase, as Stripe sends it', example: 'eur' })
    currency!: string;

    @ApiPropertyOptional({ nullable: true })
    nextPaymentAttempt!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    periodStart!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    periodEnd!: Date | null;
}
