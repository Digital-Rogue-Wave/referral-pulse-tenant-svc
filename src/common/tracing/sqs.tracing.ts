import { context as otContext, propagation, Context, trace, SpanAttributes } from '@opentelemetry/api';
import type { Message } from '@aws-sdk/client-sqs';
import { Attrs } from '@mod/types/app.type';

const setter = {
    set(carrier: Attrs, key: string, value: string) {
        carrier[key] = { DataType: 'String', StringValue: value };
    },
};

const getter = {
    get(carrier: Message['MessageAttributes'] | undefined, key: string): string | undefined {
        const v = carrier?.[key]?.StringValue;
        return typeof v === 'string' ? v : undefined;
    },
    keys(carrier: Message['MessageAttributes'] | undefined): string[] {
        return carrier ? Object.keys(carrier) : [];
    },
};

/** Inject W3C (or configured global) trace headers into SQS attributes */
export function injectTraceAttributes(attrs: Attrs): void {
    propagation.inject(otContext.active(), attrs, setter);
}

/** Extract context from SQS message attributes */
export function extractContextFromMessage(msg: Message): Context {
    return propagation.extract(otContext.active(), msg.MessageAttributes, getter);
}

/** Common span attributes for SQS consumption (OTel messaging semantic convs) */
export function baseSqsSpanAttrs(queueName: string, msg: Message): SpanAttributes {
    return {
        'messaging.system': 'aws.sqs',
        'messaging.destination': queueName,
        'messaging.destination_kind': 'queue',
        'messaging.operation': 'process',
        'messaging.message_id': msg.MessageId ?? '',
        'messaging.sqs.message_group_id': msg.Attributes?.MessageGroupId ?? msg.Attributes?.MessageGroupId ?? undefined,
        'messaging.sqs.approximate_receive_count': msg.Attributes?.ApproximateReceiveCount
            ? Number(msg.Attributes.ApproximateReceiveCount)
            : undefined,
    };
}
