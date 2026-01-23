import type { IMessageEnvelope } from '@app/types';

/**
 * Metadata key for storing idempotency configuration
 */
export const IDEMPOTENT_HANDLER_METADATA = 'idempotent:handler';

export interface IdempotentHandlerOptions {
    /**
     * TTL for idempotency key in seconds
     * @default 86400 (24 hours)
     */
    ttl?: number;

    /**
     * Custom key extractor function
     * @default Uses message.idempotencyKey || message.messageId
     */
    keyExtractor?: <T>(message: IMessageEnvelope<T>) => string;

    /**
     * Skip idempotency check (useful for debugging)
     * @default false
     */
    skip?: boolean;
}

/**
 * Decorator to mark a message handler method as idempotent.
 * Automatically checks and tracks message processing to prevent duplicates.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class CampaignConsumer {
 *   @Idempotent({ ttl: 3600 })
 *   async handleCampaignCreated(message: IMessageEnvelope<CampaignCreatedPayload>) {
 *     // This will only execute once per unique message
 *     await this.campaignService.create(message.payload);
 *   }
 * }
 * ```
 */
export function Idempotent(options: IdempotentHandlerOptions = {}): MethodDecorator {
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
        const originalMethod = descriptor.value;

        Reflect.defineMetadata(IDEMPOTENT_HANDLER_METADATA, options, target, propertyKey);

        descriptor.value = async function (this: { idempotencyService?: { executeOnce: <T>(key: string, fn: () => Promise<T>, ttl?: number) => Promise<{ result: T; isDuplicate: boolean }> } }, message: IMessageEnvelope<unknown>) {
            if (options.skip) {
                return originalMethod.apply(this, [message]);
            }

            const idempotencyService = (this as { idempotencyService?: unknown }).idempotencyService;
            if (!idempotencyService || typeof (idempotencyService as { executeOnce?: unknown }).executeOnce !== 'function') {
                console.warn(`[Idempotent] IdempotencyService not found in ${target.constructor.name}. Skipping idempotency check.`);
                return originalMethod.apply(this, [message]);
            }

            const keyExtractor = options.keyExtractor || ((msg: IMessageEnvelope<unknown>) => msg.idempotencyKey || msg.messageId);
            const idempotencyKey = keyExtractor(message);

            const { result, isDuplicate } = await (idempotencyService as { executeOnce: <T>(key: string, fn: () => Promise<T>, ttl?: number) => Promise<{ result: T; isDuplicate: boolean }> }).executeOnce(
                idempotencyKey,
                () => originalMethod.apply(this, [message]),
                options.ttl,
            );

            if (isDuplicate) {
                console.log(`[Idempotent] Message ${message.messageId} (key: ${idempotencyKey}) already processed. Skipping.`);
            }

            return result;
        };

        return descriptor;
    };
}