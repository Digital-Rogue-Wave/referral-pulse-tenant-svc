import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient, Prisma } from '@prisma-gen/generated/client';

import type { RequestContext, ITransactionOptions } from '@app/types';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

/** Type for native Prisma $transaction method to avoid ESLint no-unsafe-function-type */
type NativePrismaTransaction = PrismaClient['$transaction'];

/** Queued in-process events, handed to before-commit hooks with the transaction client. */
export type QueuedTransactionEvent = { event: string; payload: unknown };
export type BeforeCommitHook = (tx: Prisma.TransactionClient, events: QueuedTransactionEvent[]) => Promise<void>;

/**
 * Transaction-aware event emitter that delays event emission until after commit
 *
 * This service ensures events are ONLY emitted AFTER database transaction commits.
 * If transaction rolls back, events are never emitted (no phantom events).
 *
 * Usage:
 *   async create(dto: CreateDto) {
 *     return await this.prisma.$transaction(async (tx) => {
 *       const saved = await tx.entity.create({ data: dto });
 *
 *       // Event will only fire if transaction commits successfully
 *       this.txEventEmitter.emitAfterCommit('entity.created', new EntityCreatedEvent(...));
 *
 *       return saved;
 *     });
 *   }
 *
 * Guarantees:
 * - Events only fire if transaction commits successfully
 * - No phantom events if transaction rolls back
 * - Events fire in same order as emitAfterCommit calls
 * - Works with nested transactions
 *
 * Without transaction:
 * - Events emit immediately (no transaction to wait for)
 *
 * Technical Note:
 * - Replaces typeorm-transactional with Prisma-native support
 * - Uses AsyncLocalStorage via TenantContextService to track transaction state
 * - Callback executes after transaction commits (handled in DatabaseService), or immediately if no transaction
 */
@Injectable()
export class TransactionEventEmitterService {
    private readonly beforeCommitHooks: BeforeCommitHook[] = [];

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly tenantContext: TenantContextService
    ) {}

    /**
     * Runs inside every interactive transaction, after the caller's work and before commit, with the events
     * it queued — e.g. to write them to the transactional outbox in the same transaction.
     */
    registerBeforeCommitHook(hook: BeforeCommitHook): void {
        this.beforeCommitHooks.push(hook);
    }

    /**
     * Emit event after current transaction commits
     * If no transaction is active, emits immediately
     *
     * @param event - Event name (e.g., 'user.created', 'email.critical.welcome')
     * @param payload - Event payload (should be a domain event object)
     */
    emitAfterCommit(event: string, payload: unknown): void {
        const isInTransaction = this.tenantContext.get('isInTransaction');

        if (isInTransaction) {
            // Queue event for emission after commit
            const events = this.tenantContext.get('transactionEvents') || [];
            events.push({ event, payload });
            this.tenantContext.set('transactionEvents', events);
        } else {
            // No transaction, emit immediately
            this.eventEmitter.emit(event, payload);
        }
    }

    /**
     * Emit multiple events after commit
     * Useful for emitting related events together
     *
     * @param events - Array of {event, payload} objects
     */
    emitManyAfterCommit(events: Array<{ event: string; payload: unknown }>): void {
        const isInTransaction = this.tenantContext.get('isInTransaction');

        if (isInTransaction) {
            // Queue events for emission after commit
            const existingEvents = this.tenantContext.get('transactionEvents') || [];
            existingEvents.push(...events);
            this.tenantContext.set('transactionEvents', existingEvents);
        } else {
            // No transaction, emit immediately
            events.forEach(({ event, payload }) => {
                this.eventEmitter.emit(event, payload);
            });
        }
    }

    /**
     * Emit all queued transaction events
     * Called after transaction commits successfully
     */
    emitTransactionEvents(): void {
        const events = this.tenantContext.get('transactionEvents') || [];
        for (const { event, payload } of events) {
            this.eventEmitter.emit(event, payload);
        }
    }

    /**
     * Override $transaction to support event emission after successful commit
     * Wraps the native Prisma $transaction and manages the event queue in AsyncLocalStorage
     *
     * @param prisma - The PrismaClient instance to use for transactions
     * @param arg - Array of promises for sequential transactions, or callback for interactive transactions
     * @param options - Transaction options (maxWait, timeout, isolationLevel)
     */
    async transaction<T>(
        prisma: PrismaClient,
        arg: Prisma.PrismaPromise<T>[] | ((tx: Prisma.TransactionClient) => Promise<T>),
        options?: ITransactionOptions
    ): Promise<T | T[]> {
        // Handle sequential transactions (Array of Promises)
        if (Array.isArray(arg)) {
            return this.handleSequentialTransaction(prisma, arg);
        }

        // Handle interactive transaction (Callback function)
        if (typeof arg === 'function') {
            return this.handleInteractiveTransaction(prisma, arg, options);
        }

        // Fallback: should not be reached, but forward to native Prisma
        return PrismaClient.prototype.$transaction.call(prisma, arg, options) as Promise<T | T[]>;
    }

    /**
     * Handle sequential transactions (Array of Promises)
     */
    private async handleSequentialTransaction<T>(prisma: PrismaClient, promises: Prisma.PrismaPromise<T>[]): Promise<T[]> {
        if (this.tenantContext.get('isInTransaction')) {
            // Call native Prisma $transaction directly to avoid infinite recursion
            // Use bound method to preserve correct typing
            const nativeTransaction: NativePrismaTransaction = PrismaClient.prototype.$transaction.bind(prisma);
            return nativeTransaction(promises);
        }

        // The whole request context carries over (IP, user agent, metadata), not just the log fields.
        return this.tenantContext.runWithContext(
            {
                ...this.tenantContext.snapshot(),
                isInTransaction: true,
                transactionEvents: []
            },
            async () => {
                const result = await prisma.$transaction(promises);
                this.emitTransactionEvents();
                return result;
            }
        );
    }

    /**
     * Handle interactive transactions (Callback)
     */
    private async handleInteractiveTransaction<T>(
        prisma: PrismaClient,
        fn: (tx: Prisma.TransactionClient) => Promise<T>,
        options?: ITransactionOptions
    ): Promise<T> {
        if (this.tenantContext.get('isInTransaction')) {
            // Call native Prisma $transaction directly to avoid infinite recursion
            // Use bound method to preserve correct typing
            const nativeTransaction: NativePrismaTransaction = PrismaClient.prototype.$transaction.bind(prisma);
            return nativeTransaction(fn, options);
        }

        // The whole request context carries over (IP, user agent, metadata), not just the log fields.
        return this.tenantContext.runWithContext(
            {
                ...this.tenantContext.snapshot(),
                isInTransaction: true,
                transactionEvents: []
            },
            async () => {
                const result = await prisma.$transaction(async (tx) => {
                    const value = await fn(tx);
                    const queued = (this.tenantContext.get('transactionEvents') || []) as QueuedTransactionEvent[];
                    for (const hook of this.beforeCommitHooks) {
                        await hook(tx, queued);
                    }
                    return value;
                }, options);
                this.emitTransactionEvents();
                return result;
            }
        );
    }
}
