import type { Prisma } from '@prisma-gen/generated/client';

import { isPublishedEvent, toPublishedEvents } from '@common/events/outbox/published-events';
import type { BaseDomainEvent } from '@domains/common/events';

/** What one audited action records (DB Model v2 §3 `audit_log`), before the request context is added. */
export interface AuditEntry {
    action: string;
    targetType: string;
    targetId: string;
    reason: string | null;
    before: Prisma.InputJsonValue | null;
    after: Prisma.InputJsonValue | null;
}

type Change = { from: unknown; to: unknown };
type Changes = Record<string, Change>;
type EventWithPayload = BaseDomainEvent & { payload?: Record<string, unknown>; changes?: unknown };

/** Published events that are not operator actions: sign-ins, meters and trial clocks. */
const NOT_OPERATOR_ACTIONS = new Set(['user.logged_in', 'usage.threshold_crossed', 'usage.monthly_summary', 'trial.reminder', 'trial.expired']);

/** Recorded even when the system performs them (DB Model v2 §0.5: erasure is always audited). */
const AUDITED_WHEN_SYSTEM = new Set(['tenant.deleted', 'user.anonymised']);

/** Operator actions that are not published on the bus, keyed by in-process event type. */
const INTERNAL_ACTIONS: Record<string, (event: EventWithPayload) => Pick<AuditEntry, 'action' | 'targetType' | 'targetId'>> = {
    'tenant-setting.created': (e) => ({ action: 'tenant_setting.created', targetType: 'tenant_setting', targetId: e.aggregateId }),
    'tenant-setting.updated': (e) => ({ action: 'tenant_setting.updated', targetType: 'tenant_setting', targetId: e.aggregateId }),
    'api-key.updated': (e) => ({ action: 'api_key.updated', targetType: 'api_key', targetId: e.aggregateId }),
    'invitation.resent': (e) => ({ action: 'invitation.resent', targetType: 'invitation', targetId: e.aggregateId }),
    'dns.reserved': (e) => ({ action: 'subdomain.reserved', targetType: 'subdomain', targetId: String(e.payload?.slug ?? e.aggregateId) }),
    'dns.released': (e) => ({ action: 'subdomain.released', targetType: 'subdomain', targetId: String(e.payload?.slug ?? e.aggregateId) })
};

/** The principal behind an event, or null when nobody the trail should name performed it. */
export function auditActor(event: BaseDomainEvent): string | null {
    if (event.userId && event.userId !== 'system') {
        return event.userId;
    }
    return AUDITED_WHEN_SYSTEM.has(event.eventType) ? 'system' : null;
}

/**
 * Maps an in-process domain event to its audit entry, or null when the event is not an operator action.
 * Published events reuse their public name, object and properties, so the trail and the bus describe an
 * action the same way; `changes` maps split into `before` / `after`.
 */
export function toAuditEntry(event: BaseDomainEvent): AuditEntry | null {
    const type = event.eventType;
    if (NOT_OPERATOR_ACTIONS.has(type)) {
        return null;
    }
    const changes = changesOf(event as EventWithPayload);
    if (isPublishedEvent(type)) {
        const [draft] = toPublishedEvents(type, event);
        if (!draft) {
            return null;
        }
        return {
            action: draft.eventType,
            targetType: draft.object.type,
            targetId: draft.object.id,
            reason: reasonOf(draft.properties),
            ...(changes ? splitChanges(changes) : { before: null, after: draft.properties })
        };
    }
    const internal = INTERNAL_ACTIONS[type];
    if (!internal) {
        return null;
    }
    return { ...internal(event as EventWithPayload), reason: null, ...(changes ? splitChanges(changes) : { before: null, after: null }) };
}

/** Published properties name the reason per event (`reason`, `revocation_reason`, `lock_reason`, …). */
function reasonOf(properties: Record<string, unknown>): string | null {
    const found = Object.entries(properties).find(([key, value]) => key.endsWith('reason') && typeof value === 'string');
    return found ? (found[1] as string) : null;
}

function changesOf(event: EventWithPayload): Changes | null {
    const candidate = event.changes ?? event.payload?.changes;
    return isChanges(candidate) ? candidate : null;
}

function isChanges(value: unknown): value is Changes {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return Object.values(value).every((change) => typeof change === 'object' && change !== null && 'from' in change && 'to' in change);
}

function splitChanges(changes: Changes): Pick<AuditEntry, 'before' | 'after'> {
    const side = (pick: keyof Change): Prisma.InputJsonValue =>
        JSON.parse(
            JSON.stringify(Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change[pick] ?? null])))
        ) as Prisma.InputJsonValue;
    return { before: side('from'), after: side('to') };
}
