import type { Message } from '@aws-sdk/client-sqs';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';
import { AppLoggingService } from './app-logging.service';

type HasLoggerAndCls = {
    logger?: AppLoggingService;
    cls?: ClsService<ClsRequestContext>;
};

export function SqsLogged(queueName: string, batch: boolean) {
    return function (
        _target: unknown,
        _propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(msg: Message | Message[]) => Promise<unknown> | unknown>,
    ) {
        const original = descriptor.value!;
        descriptor.value = async function (this: HasLoggerAndCls, arg: Message | Message[]) {
            const logger = this.logger;
            const cls = this.cls;
            const requestId = cls?.get('requestId');
            const tenantId = cls?.get('tenantId');
            const userId = (cls?.get('userId') as string | undefined) ?? undefined;

            const startedAt = process.hrtime.bigint();

            try {
                const result = await original.apply(this, [arg]);
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

                if (!batch) {
                    const m = arg as Message;
                    logger?.info('sqs_consume', {
                        queue: queueName,
                        messageId: m.MessageId ?? 'n/a',
                        receiveCount: m.Attributes?.ApproximateReceiveCount
                            ? Number(m.Attributes.ApproximateReceiveCount)
                            : undefined,
                        tenantId,
                        userId,
                        requestId,
                        durationMs,
                    });
                } else {
                    const batchMsgs = arg as Message[];
                    logger?.info('sqs_consume_batch', {
                        queue: queueName,
                        count: batchMsgs.length,
                        firstMessageId: batchMsgs[0]?.MessageId ?? 'n/a',
                        tenantId,
                        userId,
                        requestId,
                        durationMs,
                    });
                }

                return result;
            } catch (caughtError) {
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

                if (!batch) {
                    const m = arg as Message;
                    logger?.fatal(
                        'sqs_consume_error',
                        {
                            queue: queueName,
                            messageId: m.MessageId ?? 'n/a',
                            tenantId,
                            userId,
                            requestId,
                            durationMs,
                        },
                        caughtError,
                    );
                } else {
                    logger?.fatal(
                        'sqs_consume_batch_error',
                        {
                            queue: queueName,
                            tenantId,
                            userId,
                            requestId,
                            durationMs,
                        },
                        caughtError,
                    );
                }

                throw caughtError;
            }
        };
        return descriptor;
    };
}
