import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { KetoService } from '@mod/common/auth/keto.service';
import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { Campaign } from '@mod/tenant/tenant.entity';
import { SqsManager } from '@mod/common/aws-sqs/sqs.manager';
import { CampaignEvents } from '@domains/commons/domain.event';

@Injectable()
export class CampaignService {
    constructor(
        private readonly campaignRepo: TenantAwareRepository<Campaign>,
        private readonly keto: KetoService,
        private readonly cls: ClsService,
        private readonly sqs: SqsManager
    ) {}

    async create(dto: {}) {
        const userId = this.cls.get('userId') as string;

        // Create campaign
        const campaign = this.campaignRepo.create(dto);
        await this.campaignRepo.save(campaign);

        // Grant creator full permissions in Keto
        await Promise.all([
            this.keto.createTuple({
                namespace: 'campaigns',
                object: campaign.id!,
                relation: 'owner',
                subject_id: userId
            }),
            this.keto.createTuple({
                namespace: 'campaigns',
                object: campaign.id!,
                relation: 'editor',
                subject_id: userId
            })
        ]);

        return campaign;
    }

    async delete(id: string) {
        const campaign = await this.campaignRepo.findOneOrFailTenantContext({ id });

        // Delete from DB
        await this.campaignRepo.deleteTenantContext({ id });

        // Clean up Keto permissions
        // (In production, use Keto's cascade delete or background job)

        return { deleted: true };
    }

    async createCampaign(dto: { userId: string }) {
        const campaign = await this.campaignRepo.create();

        // RequestId from HTTP request automatically propagated
        await this.sqs.sendEvent<CampaignEvents.Created>(
            'campaign.created',
            {
                campaignId: campaign.id!,
                name: campaign.name!,
                type: campaign.type!,
                createdBy: dto.userId
            },
            {
                producer: 'campaign-events',
                groupId: `campaign-${campaign.id}`
            }
        );

        return campaign;
    }
}
