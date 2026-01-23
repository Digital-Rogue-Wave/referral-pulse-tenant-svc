import { SetMetadata } from '@nestjs/common';

export const SQS_CONSUMER_METADATA = 'sqs:consumer:metadata';
export const SQS_EVENT_TYPE_METADATA = 'sqs:eventType';

export interface SqsConsumerOptions {
    /**
     * Queue name (must match queue configured in MessagingModule)
     */
    queueName: string;

    /**
     * Event type to filter messages (optional)
     */
    eventType?: string;

    /**
     * Enable batch processing (default: false)
     */
    batch?: boolean;
}

/**
 * Metadata decorator for storing SQS consumer configuration.
 * Use with @SqsMessageHandler from @ssut/nestjs-sqs.
 *
 * This is a simple metadata decorator - it doesn't change behavior.
 * Use MessageProcessorService.process() in your handler for automatic
 * envelope parsing, tenant context, idempotency, and metrics.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyConsumer {
 *   constructor(private readonly messageProcessor: MessageProcessorService) {}
 *
 *   @SqsConsumer({ queueName: 'my-queue', eventType: 'my.event' })
 *   @SqsMessageHandler('my-queue', false)
 *   async handleEvent(message: Message) {
 *     await this.messageProcessor.process<MyPayload>(message, async (envelope) => {
 *       // Process envelope.payload - idempotency handled automatically
 *     });
 *   }
 * }
 * ```
 */
export function SqsConsumer(options: SqsConsumerOptions): MethodDecorator {
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
        // Store metadata for potential future use
        SetMetadata(SQS_CONSUMER_METADATA, options)(target, propertyKey, descriptor);
        if (options.eventType) {
            SetMetadata(SQS_EVENT_TYPE_METADATA, options.eventType)(target, propertyKey, descriptor);
        }

        return descriptor;
    };
}