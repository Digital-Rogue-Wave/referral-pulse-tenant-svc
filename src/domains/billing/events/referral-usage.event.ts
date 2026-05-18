import { BaseDomainEvent } from '@app/domains';

export interface ReferralUsageEvent extends BaseDomainEvent {
    metric: string;
    delta: number;
    [key: string]: unknown;
}
