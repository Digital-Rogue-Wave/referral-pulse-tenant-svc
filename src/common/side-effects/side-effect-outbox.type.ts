export type SideEffectType = 'sqs' | 'sns' | 'keto';
export type SideEffectStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** The queue every side effect but Keto runs on. */
export const OUTBOX_QUEUE = 'outbox-processor';

/**
 * Keto membership effects run on their own queue, one at a time across all pods (E1 decision D7, US1.3.1 F2):
 * membership changes are rare, so throughput doesn't matter, and strict order removes the race between a
 * user's successive role changes.
 */
export const KETO_OUTBOX_QUEUE = 'keto-outbox';

export const outboxQueueFor = (effectType: string): string => (effectType === 'keto' ? KETO_OUTBOX_QUEUE : OUTBOX_QUEUE);
