import { ApiProperty } from '@nestjs/swagger';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { BillingPlanEnum, SubscriptionStatusEnum, TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { FileDto } from '@mod/files/dto/file.dto';

export class TenantDto extends EntityHelperDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;

    @ApiProperty()
    slug: string;

    @ApiProperty({
        type: FileDto,
        required: false
    })
    image?: FileDto | null;

    @ApiProperty({
        enum: TenantStatusEnum,
        enumName: 'TenantStatusEnum',
        description: 'The status of the tenant'
    })
    status: TenantStatusEnum;

    @ApiProperty({
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum',
        description: 'The current billing plan of the tenant'
    })
    billingPlan: BillingPlanEnum;

    @ApiProperty({
        enum: SubscriptionStatusEnum,
        enumName: 'SubscriptionStatusEnum',
        description: 'The subscription status of the tenant'
    })
    subscriptionStatus: SubscriptionStatusEnum;

    @ApiProperty({ description: 'Custom settings for the tenant' })
    settings: Record<string, any>;
}
