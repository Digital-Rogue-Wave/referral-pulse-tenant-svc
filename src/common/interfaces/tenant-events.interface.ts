import { TenantEntity } from '@mod/tenant/tenant.entity';
import { UpdateTenantDto } from '@mod/tenant/dto/tenant/update-tenant.dto';

export interface TenantDomainVerifiedEvent {
    tenant: TenantEntity;
}

export interface TenantCreatedEvent {
    tenant: TenantEntity;
    ownerId: string;
}

export interface TenantUpdatedEvent {
    tenant: TenantEntity;
    oldTenant: TenantEntity;
    changes: UpdateTenantDto;
    userId?: string;
    userEmail?: string;
    ipAddress?: string;
}

export interface TenantDeletionScheduledEvent {
    tenant: TenantEntity;
    userId: string;
    userEmail: string;
    scheduledAt: Date;
    executionDate: Date;
    reason?: string;
    ipAddress?: string;
}

export interface TenantDeletionCancelledEvent {
    tenant: TenantEntity;
    userId: string;
    userEmail: string;
    ipAddress?: string;
}

export interface TenantDeletedEvent {
    tenant: TenantEntity;
    deletedAt: Date;
}

export interface TenantSuspendedEvent {
    tenantId: string;
    reason?: string;
}

export interface TenantUnsuspendedEvent {
    tenantId: string;
}
