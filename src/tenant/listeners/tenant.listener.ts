import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { AuditService } from '@mod/common/audit/audit.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { Utils } from '@mod/common/utils/utils';
import { KetoRelationTupleDto } from '@mod/common/auth/dto/keto-relation-tuple.dto';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { CreateAuditLogDto } from '@mod/common/audit/create-audit-log.dto';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { TenantEntity } from '../tenant.entity';
import { UpdateTenantDto } from '../dto/tenant/update-tenant.dto';

@Injectable()
export class TenantListener {
    constructor(
        private readonly sns: SnsPublisher,
        private readonly auditService: AuditService,
        private readonly ketoService: KetoService
    ) {}

    @OnEvent('tenant.created')
    async handleTenantCreatedEvent(payload: { tenant: TenantEntity; ownerId: string }) {
        const { tenant, ownerId } = payload;

        // 1. Create Keto tuple
        const tuple = await Utils.validateDtoOrFail(KetoRelationTupleDto, {
            namespace: KetoNamespace.TENANT,
            object: tenant.id,
            relation: KetoRelation.MEMBER,
            subject_id: ownerId
        });
        await this.ketoService.createTuple(tuple);

        // 2. Audit Log
        const auditLogDto = await Utils.validateDtoOrFail(CreateAuditLogDto, {
            tenantId: tenant.id,
            userId: ownerId,
            action: AuditAction.TENANT_CREATED,
            description: `Tenant "${tenant.name}" created`,
            metadata: {
                slug: tenant.slug
            }
        });
        await this.auditService.log(auditLogDto);

        // 3. Publish SNS Event
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: tenant.id,
            eventType: 'tenant.created',
            data: {
                ...tenant,
                ownerId: ownerId
            } as any,
            timestamp: new Date().toISOString()
        });
        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: tenant.id,
            deduplicationId: tenant.id
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);
    }

    @OnEvent('tenant.updated')
    async handleTenantUpdatedEvent(payload: {
        tenant: TenantEntity;
        oldTenant: TenantEntity;
        changes: UpdateTenantDto;
        userId?: string;
        userEmail?: string;
        ipAddress?: string;
    }) {
        const { tenant, oldTenant, changes, userId, userEmail, ipAddress } = payload;

        // 1. Audit Log
        await this.auditService.log({
            tenantId: tenant.id,
            userId,
            userEmail,
            action: AuditAction.TENANT_UPDATED,
            description: `Tenant "${tenant.name}" updated`,
            metadata: {
                changes: changes,
                previousValues: {
                    name: oldTenant.name,
                    slug: oldTenant.slug,
                    status: oldTenant.status
                }
            },
            ipAddress
        });

        // 2. Publish SNS Event
        await this.sns.publish(
            {
                eventId: tenant.id,
                eventType: 'tenant.updated',
                data: {
                    ...tenant,
                    changes: changes
                } as unknown as any,
                timestamp: new Date().toISOString()
            },
            {
                topic: 'tenant-events',
                groupId: tenant.id,
                deduplicationId: `${tenant.id}-${Date.now()}`
            }
        );
    }
}
