import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import sqsConfig from '@mod/config/sqs.config';

@Injectable()
export class DlqMonitorService {
    private readonly sqsClient: SQSClient;
    private readonly dlqUrls: Map<string, string> = new Map();

    constructor(
        private readonly logger: AppLoggingService,
        private readonly metrics: MonitoringService,
        private readonly config: ConfigService
    ) {
        const awsRegion = this.config.getOrThrow<string>('awsConfig.region', { infer: true });
        this.sqsClient = new SQSClient({ region: awsRegion });

        // Build DLQ map
        const cfg = this.config.getOrThrow<ConfigType<typeof sqsConfig>>('sqsConfig', { infer: true });

        for (const consumer of cfg.consumers) {
            if (consumer.dlqUrl) {
                this.dlqUrls.set(consumer.name, consumer.dlqUrl);
            }
        }
    }

    /**
     * Check DLQ depths for all queues
     * Call this from a scheduled task or health check
     */
    async checkAllDlqs(): Promise<Map<string, number>> {
        const depths = new Map<string, number>();

        for (const [queueName, dlqUrl] of this.dlqUrls.entries()) {
            try {
                const depth = await this.getDlqDepth(dlqUrl);
                depths.set(queueName, depth);

                // Record metric
                this.metrics.recordGauge('sqs_dlq_depth', depth, { queue: queueName });

                // Alert if DLQ has messages
                if (depth > 0) {
                    this.logger.warn(`DLQ has messages - queue: ${queueName}, dlqDepth: ${depth}, dlqUrl: ${dlqUrl}`);
                }
            } catch (error) {
                this.logger.error(`Failed to check DLQ - queue: ${queueName}, error: ${(error as Error).message}`);
            }
        }

        return depths;
    }

    /**
     * Get message count in DLQ
     */
    private async getDlqDepth(dlqUrl: string): Promise<number> {
        const command = new GetQueueAttributesCommand({
            QueueUrl: dlqUrl,
            AttributeNames: ['ApproximateNumberOfMessages']
        });

        const response = await this.sqsClient.send(command);
        const count = response.Attributes?.ApproximateNumberOfMessages;

        return count ? parseInt(count, 10) : 0;
    }

    /**
     * Get single DLQ depth by queue name
     */
    async getDlqDepthByQueue(queueName: string): Promise<number> {
        const dlqUrl = this.dlqUrls.get(queueName);
        if (!dlqUrl) {
            throw new Error(`No DLQ configured for queue: ${queueName}`);
        }

        return this.getDlqDepth(dlqUrl);
    }
}
