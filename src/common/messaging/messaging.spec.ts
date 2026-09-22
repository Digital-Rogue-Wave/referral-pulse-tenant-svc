import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';
import type { SqsService } from '@ssut/nestjs-sqs';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import { DateService } from '@common/helper/date.service';
import { EnvironmentService } from '@common/helper/environment.service';
import { JsonService } from '@common/helper/json.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MessagingMetricsService } from '@common/monitoring/messaging-metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import { MessageEnvelopeService } from './message-envelope.service';
import { SnsPublisherService } from './sns-publisher.service';
import { SqsProducerService } from './sqs-producer.service';

describe('Messaging producers', () => {
    let context: MockProxy<TenantContextService>;
    let tracing: MockProxy<TracingService>;
    let metrics: MockProxy<MessagingMetricsService>;
    let envelopes: MessageEnvelopeService;
    let config: MockProxy<ConfigService>;

    beforeEach(() => {
        context = mock<TenantContextService>();
        context.getTenantId.mockReturnValue('t1');
        context.getUserId.mockReturnValue('u1');
        context.getCorrelationId.mockReturnValue('corr-1');
        tracing = mock<TracingService>();
        tracing.withSpan.mockImplementation((_name, fn) => fn({} as never));
        metrics = mock<MessagingMetricsService>();
        config = mock<ConfigService>();
        config.getOrThrow.mockImplementation(
            (key: string) =>
                ({
                    'app.name': 'tenant-service',
                    'aws.sns.topics': [{ name: 'tenant-events', arn: 'arn:aws:sns:eu-central-1:1:tenant-events.fifo' }],
                    'aws.sqs.queues': [{ name: 'notification-webhook-svc.fifo', url: 'http://sqs/notification-webhook-svc.fifo' }]
                })[key]
        );
        const dates = mock<DateService>();
        dates.nowISO.mockReturnValue('2026-09-22T00:00:00.000Z');
        envelopes = new MessageEnvelopeService(config as never, context, tracing, mock<AppLoggerService>(), dates, new JsonService());
    });

    describe('MessageEnvelopeService', () => {
        it('wraps a payload with the tenant, actor, correlation and trace of the current request', () => {
            const envelope = envelopes.createEnvelope('tenant.created', { a: 1 }, 'tenant.created:t1');
            expect(envelope).toMatchObject({
                eventType: 'tenant.created',
                source: 'tenant-service',
                tenantId: 't1',
                correlationId: 'corr-1',
                idempotencyKey: 'tenant.created:t1',
                payload: { a: 1 },
                metadata: { userId: 'u1' }
            });
            expect(envelope.metadata.traceId).toBeTruthy();
        });

        it.each([
            ['tenantId', () => context.getTenantId.mockReturnValue(undefined)],
            ['userId', () => context.getUserId.mockReturnValue(undefined)],
            ['correlationId', () => context.getCorrelationId.mockReturnValue(undefined)]
        ])('refuses to build an envelope without %s', (field, unset) => {
            unset();
            expect(() => envelopes.createEnvelope('e', {})).toThrow(field);
        });
    });

    describe('SnsPublisherService', () => {
        let sns: SnsPublisherService;
        let send: jest.Mock;

        beforeEach(() => {
            const environment = mock<EnvironmentService>();
            environment.getAwsClientConfig.mockReturnValue({ region: 'eu-central-1' } as never);
            sns = new SnsPublisherService(config as never, environment, envelopes, tracing, metrics, mock<AppLoggerService>(), new JsonService());
            sns.onModuleInit();
            send = jest.fn().mockResolvedValue({ MessageId: 'm-1' });
            Object.assign(sns, { client: { send } });
        });

        it('publishes the envelope with the group, the dedup id and filterable attributes', async () => {
            await expect(
                sns.publish('tenant-events', 'tenant.created', { a: 1 }, { messageGroupId: 't1', messageDeduplicationId: 'evt-1' })
            ).resolves.toBe('m-1');

            const input = send.mock.calls[0]![0].input;
            expect(input).toMatchObject({
                TopicArn: 'arn:aws:sns:eu-central-1:1:tenant-events.fifo',
                MessageGroupId: 't1',
                MessageDeduplicationId: 'evt-1',
                MessageAttributes: { eventType: { DataType: 'String', StringValue: 'tenant.created' } }
            });
            expect(metrics.recordOutboundMessage).toHaveBeenCalledWith('tenant-events', 'tenant.created', true, expect.any(Number));
        });

        it('refuses an unknown topic and records failures', async () => {
            await expect(sns.publish('nope', 'e', {})).rejects.toThrow('Topic not configured: nope');
            send.mockRejectedValue(new Error('throttled'));
            await expect(sns.publish('tenant-events', 'e', {})).rejects.toThrow('throttled');
            expect(metrics.recordOutboundMessage).toHaveBeenLastCalledWith('tenant-events', 'e', false, expect.any(Number));
        });
    });

    describe('SqsProducerService', () => {
        let sqs: MockProxy<SqsService>;
        let producer: SqsProducerService;

        beforeEach(() => {
            sqs = mock<SqsService>();
            producer = new SqsProducerService(sqs, config as never, envelopes, tracing, metrics, mock<AppLoggerService>());
        });

        it('sends the envelope, deduplicated on the business idempotency key', async () => {
            const id = await producer.send(
                'notification-webhook-svc.fifo',
                'email.send',
                { to: 'x' },
                { idempotencyKey: 'inv-1', messageGroupId: 't1' }
            );

            expect(sqs.send).toHaveBeenCalledWith(
                'notification-webhook-svc.fifo',
                expect.objectContaining({ id, groupId: 't1', deduplicationId: 'inv-1' })
            );
        });

        it('refuses an unknown queue and records failures', async () => {
            await expect(producer.send('nope', 'e', {})).rejects.toThrow('Queue not configured: nope');
            sqs.send.mockRejectedValue(new Error('down'));
            await expect(producer.send('notification-webhook-svc.fifo', 'e', {})).rejects.toThrow('down');
            expect(metrics.recordOutboundMessage).toHaveBeenLastCalledWith('notification-webhook-svc.fifo', 'e', false, expect.any(Number));
        });
    });
});
