import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpcomingInvoiceDto {
    @ApiProperty()
    amountDue: number;

    @ApiProperty()
    currency: string;

    @ApiPropertyOptional()
    nextPaymentAttempt?: Date | null;

    @ApiPropertyOptional()
    periodStart?: Date | null;

    @ApiPropertyOptional()
    periodEnd?: Date | null;
}
