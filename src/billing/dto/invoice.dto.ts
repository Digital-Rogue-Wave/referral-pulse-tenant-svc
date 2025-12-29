import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceDto {
    @ApiProperty()
    id: string;

    @ApiPropertyOptional()
    number?: string | null;

    @ApiPropertyOptional()
    status?: string | null;

    @ApiProperty()
    currency: string;

    @ApiProperty()
    amountDue: number;

    @ApiProperty()
    amountPaid: number;

    @ApiProperty()
    createdAt: Date;

    @ApiPropertyOptional()
    periodStart?: Date | null;

    @ApiPropertyOptional()
    periodEnd?: Date | null;

    @ApiPropertyOptional()
    hostedInvoiceUrl?: string | null;

    @ApiPropertyOptional()
    invoicePdfUrl?: string | null;
}
