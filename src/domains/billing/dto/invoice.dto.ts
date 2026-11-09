import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceDto {
    @ApiProperty()
    id!: string;

    @ApiPropertyOptional({ nullable: true })
    number!: string | null;

    @ApiPropertyOptional({ nullable: true })
    status!: string | null;

    @ApiProperty({ description: 'ISO 4217, lowercase, as Stripe sends it', example: 'eur' })
    currency!: string;

    @ApiProperty({ description: 'Integer in minor units (cents), as Stripe sends it', example: 4900 })
    amountDue!: number;

    @ApiProperty({ description: 'Integer in minor units (cents), as Stripe sends it', example: 4900 })
    amountPaid!: number;

    @ApiProperty()
    createdAt!: Date;

    @ApiPropertyOptional({ nullable: true })
    periodStart!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    periodEnd!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    hostedInvoiceUrl!: string | null;

    @ApiPropertyOptional({ nullable: true })
    invoicePdfUrl!: string | null;
}
