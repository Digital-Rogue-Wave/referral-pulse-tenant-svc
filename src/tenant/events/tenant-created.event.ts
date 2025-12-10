import { TenantEntity } from '../tenant.entity';

export class TenantCreatedEvent {
    constructor(
        public readonly tenant: TenantEntity,
        public readonly ownerId: string
    ) {}
}
