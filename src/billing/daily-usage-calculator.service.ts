import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { TenantUsageEntity } from './tenant-usage.entity';
import { RedisUsageService } from './redis-usage.service';
import { BillingEventEntity } from './billing-event.entity';

@Injectable()
export class DailyUsageCalculator {
    private readonly logger = new Logger(DailyUsageCalculator.name);

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

    async runDailySnapshot(): Promise<void> {
        const now = new Date();
        const periodDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const month = now.toISOString().slice(0, 7); // YYYY-MM

        this.logger.log(`Running daily usage snapshot for date ${periodDate}`);

        const tenants = await this.tenantRepository.find({ where: { status: TenantStatusEnum.ACTIVE } });

        for (const tenant of tenants) {
            const tenantId = tenant.id;
            const metrics = await this.redisUsageService.listMetrics(tenantId);

            if (!metrics || metrics.length === 0) {
                continue;
            }

            for (const metric of metrics) {
                const usage = await this.redisUsageService.getUsage(tenantId, metric, month);
                const limit = await this.redisUsageService.getLimit(tenantId, metric);

                let row = await this.usageRepository.findOne({ where: { tenantId, metricName: metric, periodDate } });

                if (!row) {
                    row = this.usageRepository.create({
                        tenantId,
                        metricName: metric,
                        periodDate,
                        currentUsage: usage,
                        limitValue: limit ?? null
                    });
                } else {
                    row.currentUsage = usage;
                    if (limit != null) {
                        row.limitValue = limit;
                    }
                }

                await this.usageRepository.save(row);

                if (limit && limit > 0) {
                    const percentage = (usage / limit) * 100;
                    for (const threshold of [80, 100]) {
                        if (percentage >= threshold) {
                            const alreadyTriggered = await this.redisUsageService.isThresholdTriggered(tenantId, metric, threshold);

                            if (!alreadyTriggered) {
                                await this.redisUsageService.markThresholdTriggered(tenantId, metric, threshold);

                                const billingEvent = this.billingEventRepository.create({
                                    tenantId,
                                    eventType: 'usage.threshold_crossed',
                                    metricName: metric,
                                    increment: null,
                                    timestamp: new Date(),
                                    metadata: {
                                        threshold,
                                        usage,
                                        limit,
                                        percentage
                                    }
                                });

                                await this.billingEventRepository.save(billingEvent);

                                this.logger.warn(
                                    `Usage threshold ${threshold}% crossed for tenant ${tenantId}, metric ${metric} (usage=${usage}, limit=${limit})`
                                );

                                this.eventEmitter.emit('usage.threshold_crossed', {
                                    tenantId,
                                    metric,
                                    threshold,
                                    usage,
                                    limit,
                                    percentage,
                                    periodDate,
                                    month,
                                    triggeredAt: now.toISOString()
                                });
                            }
                        }
                    }
                }
            }
        }
    }
}
