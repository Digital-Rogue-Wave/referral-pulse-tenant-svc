import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { PlanLimits } from '../plan-limits.type';

export class PlanDto extends EntityHelperDto {
    @ApiProperty()
    @AutoMap()
    id: string;

    @ApiProperty()
    @AutoMap()
    name: string;

    @ApiPropertyOptional()
    @AutoMap()
    stripePriceId?: string | null;

    @ApiPropertyOptional()
    @AutoMap()
    stripeProductId?: string | null;

    @ApiPropertyOptional()
    @AutoMap()
    interval?: string | null;

    @ApiPropertyOptional()
    @AutoMap()
    limits?: PlanLimits | null;

    @ApiPropertyOptional()
    @AutoMap()
    tenantId?: string | null;

    @ApiProperty()
    @AutoMap()
    isActive: boolean;

    @ApiProperty()
    @AutoMap()
    manualInvoicing: boolean;

    @ApiPropertyOptional()
    @AutoMap()
    metadata?: Record<string, any> | null;
}
