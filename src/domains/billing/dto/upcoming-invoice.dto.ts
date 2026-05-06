import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpcomingInvoiceDto {
    @ApiProperty()
    amountDue!: number;

    @ApiProperty()
    currency!: string;

    @ApiPropertyOptional({ nullable: true })
    nextPaymentAttempt!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    periodStart!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    periodEnd!: Date | null;
}
