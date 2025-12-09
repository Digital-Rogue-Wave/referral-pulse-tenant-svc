import { Inject, Injectable, Optional } from '@nestjs/common';
import { PublishCommand } from '@aws-sdk/client-sns';
import { ConfigService, ConfigType } from '@nestjs/config';
import snsConfig, { type TopicDef } from '@mod/config/sns.config';
import { SnsFactory } from './sns.factory';
import { createHash, randomUUID } from 'node:crypto';
import { Json, PublishOptions } from '@mod/types/app.type';
import { TenantContext } from '@mod/types/app.interface';

@Injectable()
export class SnsPublisher {
    private readonly topics: ReadonlyArray<TopicDef>;

    constructor(
        private readonly factory: SnsFactory,
        private readonly configService: ConfigService,
        @Optional() @Inject(TenantContext) private readonly tenant?: TenantContext,
    ) {
        this.topics = this.configService
            .getOrThrow<ConfigType<typeof snsConfig>>('snsConfig', { infer: true })
            .topics;
    }

    private findTopic(name: string): TopicDef {
        const topic = this.topics.find((t) => t.name === name);
        if (!topic) throw new Error(`[SNS] Unknown topic "${name}"`);
        return topic;
    }

    private getTenantId(): string | undefined {
        return this.tenant?.getTenantId?.();
    }

    private defaultGroupId(): string {
        return this.getTenantId() ?? 'global';
    }

    private defaultDedupId(payload: unknown): string {
        const hash = createHash('sha256');
        hash.update(JSON.stringify(payload));
        hash.update('|');
        hash.update(this.getTenantId() ?? 'global');
        return hash.digest('hex');
    }

    async publish<T extends Json>(payload: T, options: PublishOptions): Promise<void> {
        const topicDef = this.findTopic(options.topic);
        const client = this.factory.getClient();

        const message = JSON.stringify(payload);
        const messageAttributes: Record<string, { DataType: 'String'; StringValue: string }> = {};

        const tenantId = this.getTenantId();
        if (tenantId) messageAttributes.tenantId = { DataType: 'String', StringValue: tenantId };
        if (options.attributes) {
            for (const [key, value] of Object.entries(options.attributes)) {
                messageAttributes[key] = { DataType: 'String', StringValue: value };
            }
        }

        const command = new PublishCommand({
            TopicArn: topicDef.topicArn,
            Message: message,
            Subject: options.subject,
            MessageAttributes: messageAttributes,
            ...(topicDef.fifo
                ? {
                    MessageGroupId: options.groupId ?? this.defaultGroupId(),
                    MessageDeduplicationId:
                        options.deduplicationId ?? this.defaultDedupId(payload) ?? randomUUID(),
                }
                : {}),
        });

        await client.send(command);
    }
}
