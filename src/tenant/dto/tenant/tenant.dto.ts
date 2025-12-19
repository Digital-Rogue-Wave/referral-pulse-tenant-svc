import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';
import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { BillingPlanEnum, SubscriptionStatusEnum, TenantStatusEnum, DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';
import { FileDto } from '@mod/files/dto/file.dto';

export class TenantDto extends EntityHelperDto {
    @ApiProperty()
    @AutoMap()
    id: string;

    @ApiProperty()
    @AutoMap()
    name: string;

    @ApiProperty()
    @AutoMap()
    slug: string;

    @ApiProperty({
        type: FileDto,
        required: false
    })
    @AutoMap(() => FileDto)
    image?: FileDto | null;

    @ApiProperty({
        enum: TenantStatusEnum,
        enumName: 'TenantStatusEnum',
        description: 'The status of the tenant'
    })
    @AutoMap()
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

    @ApiProperty({ required: false })
    @AutoMap()
    customDomain?: string;

    @ApiProperty({
        enum: DomainVerificationStatusEnum,
        enumName: 'DomainVerificationStatusEnum',
        required: false
    })
    @AutoMap()
    domainVerificationStatus?: DomainVerificationStatusEnum;

    @ApiProperty({ required: false })
    @AutoMap()
    domainVerificationToken?: string;
}
