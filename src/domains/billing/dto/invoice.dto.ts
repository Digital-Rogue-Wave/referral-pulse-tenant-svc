import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceDto {
    @ApiProperty()
    id!: string;

    @ApiPropertyOptional({ nullable: true })
    number!: string | null;

    @ApiPropertyOptional({ nullable: true })
    status!: string | null;

    @ApiProperty()
    currency!: string;

    @ApiProperty()
    amountDue!: number;

    @ApiProperty()
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
