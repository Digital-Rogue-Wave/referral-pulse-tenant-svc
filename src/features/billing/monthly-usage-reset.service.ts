import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { TenantStatusEnum } from '@common/enums/tenant.enum';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';

@Injectable()
export class MonthlyUsageResetService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
        private readonly redis: RedisService,
        private readonly eventEmitter: EventEmitter2,
    ) {
        this.logger.setContext(MonthlyUsageResetService.name);
    }

    async runMonthlyReset(): Promise<void> {
        const now = new Date();
        const { prevMonthLabel, prevMonthEnd } = this.getPreviousCalendarMonth(now);

        this.logger.log(`Running monthly usage reset for month ${prevMonthLabel}`);

        const tenants = await this.prisma.tenant.findMany({
            where: {
                status: TenantStatusEnum.ACTIVE,
                deletedAt: null,
            },
        });

        for (const tenant of tenants) {
            const tenantId = tenant.id;

            await this.tenantContext.runWithContext({ tenantId }, async () => {
                const metrics = await this.redis.listMetrics();

                if (!metrics || metrics.length === 0) {
                    return;
                }

                for (const metric of metrics) {
                    let usage = 0;

                    const snapshot = await this.prisma.tenantUsage.findFirst({
                        where: {
                            tenantId,
                            metricName: metric,
                            periodDate: prevMonthEnd,
                            deletedAt: null,
                        },
                    });

                    if (snapshot) {
                        usage = snapshot.currentUsage;
                    } else {
                        usage = await this.redis.getUsage(metric, prevMonthLabel);
                    }

                    const limit = await this.redis.getLimit(metric);

                    await this.prisma.billingEvent.create({
                        data: {
                            tenantId,
                            eventType: 'usage.monthly_summary',
                            metricName: metric,
                            increment: null,
                            timestamp: new Date(),
                            metadata: {
                                month: prevMonthLabel,
                                usage,
                                limit,
                            },
                        },
                    });

                    this.eventEmitter.emit('usage.monthly_summary', {
                        tenantId,
                        metric,
                        month: prevMonthLabel,
                        usage,
                        limit,
                        periodDate: prevMonthEnd,
                        triggeredAt: now.toISOString(),
                    });

                    await this.redis.clearMonthlyUsage(metric, prevMonthLabel);
                    await this.redis.clearThresholdFlags(metric, [80, 100]);
                }
            });
        }
    }

    private getPreviousCalendarMonth(ref: Date): {
        prevMonthLabel: string;
        prevMonthEnd: string;
    } {
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
