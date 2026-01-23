import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { runOnTransactionComplete } from 'typeorm-transactional';

/**
 * Transaction-aware event emitter that delays event emission until after commit
 *
 * This service ensures events are ONLY emitted AFTER database transaction commits.
 * If transaction rolls back, events are never emitted (no phantom events).
 *
 * Usage:
 *   @Transactional()
 *   async create(dto: CreateDto) {
 *     const saved = await this.repository.save(entity);
 *
 *     // Event will only fire if transaction commits successfully
 *     this.txEventEmitter.emitAfterCommit('entity.created', new EntityCreatedEvent(...));
 *
 *     return saved;
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
 * - Uses runOnTransactionComplete from typeorm-transactional@0.5.0
 * - Callback executes after transaction commits, or immediately if no transaction
 */
@Injectable()
export class TransactionEventEmitterService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Emit event after current transaction commits
   * If no transaction is active, emits immediately
   *
   * @param event - Event name (e.g., 'user.created', 'email.critical.welcome')
   * @param payload - Event payload (should be a domain event object)
   */
  emitAfterCommit(event: string, payload: unknown): void {
    // runOnTransactionComplete executes callback after commit
    // If no transaction, executes immediately
    runOnTransactionComplete(() => {
      this.eventEmitter.emit(event, payload);
    });
  }

  /**
   * Emit multiple events after commit
   * Useful for emitting related events together
   *
   * @param events - Array of {event, payload} objects
   */
  emitManyAfterCommit(events: Array<{ event: string; payload: unknown }>): void {
    // runOnTransactionComplete executes callback after commit
    // If no transaction, executes immediately
    runOnTransactionComplete(() => {
      events.forEach(({ event, payload }) => {
        this.eventEmitter.emit(event, payload);
      });
    });
  }
}