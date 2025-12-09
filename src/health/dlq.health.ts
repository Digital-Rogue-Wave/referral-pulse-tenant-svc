import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { DlqMonitorService } from '@mod/common/messaging/dlq-monitor.service';

@Injectable()
export class DlqHealthIndicator extends HealthIndicator {
    constructor(private readonly dlqMonitor: DlqMonitorService) {
        super();
    }

    async isHealthy(key: string): Promise<HealthIndicatorResult> {
        try {
            const depths = await this.dlqMonitor.checkAllDlqs();
            const totalMessages = Array.from(depths.values()).reduce((sum, depth) => sum + depth, 0);

            if (totalMessages > 100) {
                // Threshold: alert if total DLQ messages exceed 100
                const result = this.getStatus(key, false, {
                    dlqMessageCount: totalMessages,
                    queues: Object.fromEntries(depths),
                });
                throw new HealthCheckError('DLQ threshold exceeded', result);
            }

            return this.getStatus(key, true, {
                dlqMessageCount: totalMessages,
                queues: Object.fromEntries(depths),
            });
        } catch (error) {
            throw new HealthCheckError('DLQ check failed', error);
        }
    }
}
