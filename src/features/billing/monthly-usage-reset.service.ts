import { Injectable } from '@nestjs/common';

import { TenantStatusEnum } from '@common/enums/tenant.enum';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { DateService } from '@common/helper/date.service';

import { BillingEvents, UsageMonthlySummaryEvent } from '@domains/billing';

@Injectable()
export class MonthlyUsageResetService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
        private readonly redis: RedisService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly dateService: DateService
    ) {
        this.logger.setContext(MonthlyUsageResetService.name);
    }

    async runMonthlyReset(): Promise<void> {
        const now = this.dateService.nowMoment();
        const { prevMonthLabel, prevMonthEnd } = this.getPreviousCalendarMonth(now.toDate());

        this.logger.log(`Running monthly usage reset for month ${prevMonthLabel}`);

        const tenants = await this.prisma.tenant.findMany({
            where: {
                status: TenantStatusEnum.ACTIVE,
                deletedAt: null
            }
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
                            deletedAt: null
                        }
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
                                limit
                            }
                        }
                    });

                    this.txEventEmitter.emitAfterCommit(
                        BillingEvents.USAGE_MONTHLY_SUMMARY,
                        new UsageMonthlySummaryEvent(
                            tenantId,
                            tenantId,
                            metric,
                            prevMonthLabel,
                            usage,
                            limit,
                            prevMonthEnd,
                            this.dateService.toISO(now)
                        )
                    );

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
        const prev = this.dateService.subtract(ref, 1, 'month');
        return {
            prevMonthLabel: this.dateService.format(prev, 'YYYY-MM'),
            prevMonthEnd: this.dateService.format(this.dateService.endOf(prev, 'month'), 'YYYY-MM-DD')
        };
    }
}
