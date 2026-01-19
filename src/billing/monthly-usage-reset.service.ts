import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { TenantUsageEntity } from './tenant-usage.entity';
import { BillingEventEntity } from './billing-event.entity';
import { RedisUsageService } from './redis-usage.service';

@Injectable()
export class MonthlyUsageResetService {
    private readonly logger = new Logger(MonthlyUsageResetService.name);

    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        @InjectRepository(TenantUsageEntity)
        private readonly usageRepository: Repository<TenantUsageEntity>,
        @InjectRepository(BillingEventEntity)
        private readonly billingEventRepository: Repository<BillingEventEntity>,
        private readonly redisUsageService: RedisUsageService,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async runMonthlyReset(): Promise<void> {
        const now = new Date();
        const { prevMonthLabel, prevMonthEnd } = this.getPreviousCalendarMonth(now);

        this.logger.log(`Running monthly usage reset for month ${prevMonthLabel}`);

        const tenants = await this.tenantRepository.find({ where: { status: TenantStatusEnum.ACTIVE } });

        for (const tenant of tenants) {
            const tenantId = tenant.id;
            const metrics = await this.redisUsageService.listMetrics(tenantId);

            if (!metrics || metrics.length === 0) {
                continue;
            }

            for (const metric of metrics) {
                let usage = 0;

                const snapshot = await this.usageRepository.findOne({
                    where: {
                        tenantId,
                        metricName: metric,
                        periodDate: prevMonthEnd
                    }
                });

                if (snapshot) {
                    usage = snapshot.currentUsage;
                } else {
                    usage = await this.redisUsageService.getUsage(tenantId, metric, prevMonthLabel);
                }

                const limit = await this.redisUsageService.getLimit(tenantId, metric);

                const summaryEvent = this.billingEventRepository.create({
                    tenantId,
                    eventType: 'usage.monthly_summary',
                    metricName: metric,
                    increment: null,
                    timestamp: new Date(),
                    metadata: {
                        month: prevMonthLabel,
                        usage,
                        limit
                    }
                });

                await this.billingEventRepository.save(summaryEvent);

                this.eventEmitter.emit('usage.monthly_summary', {
                    tenantId,
                    metric,
                    month: prevMonthLabel,
                    usage,
                    limit,
                    periodDate: prevMonthEnd,
                    triggeredAt: now.toISOString()
                });

                await this.redisUsageService.clearMonthlyUsage(tenantId, metric, prevMonthLabel);
                await this.redisUsageService.clearThresholdFlags(tenantId, metric, [80, 100]);
            }
        }
    }

    private getPreviousCalendarMonth(ref: Date): { prevMonthLabel: string; prevMonthEnd: string } {
        const year = ref.getUTCFullYear();
        const monthIndex = ref.getUTCMonth(); // 0-11

        const prevYear = monthIndex === 0 ? year - 1 : year;
        const prevMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1;
        const prevMonth = prevMonthIndex + 1; // 1-12

        const end = new Date(Date.UTC(prevYear, prevMonthIndex + 1, 0));
        const prevMonthLabel = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
        const prevMonthEnd = end.toISOString().slice(0, 10);

        return { prevMonthLabel, prevMonthEnd };
    }
}
