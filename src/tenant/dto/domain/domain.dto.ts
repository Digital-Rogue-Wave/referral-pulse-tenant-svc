import { ApiProperty } from '@nestjs/swagger';
import { DomainVerificationStatusEnum } from '@mod/common/enums/tenant.enum';

export class DomainDto {
    @ApiProperty()
    customDomain: string;

    @ApiProperty({
        enum: DomainVerificationStatusEnum,
        enumName: 'DomainVerificationStatusEnum'
    })
    domainVerificationStatus: DomainVerificationStatusEnum;

    @ApiProperty()
    domainVerificationToken: string;
}
