import type { Prisma } from '@prisma-gen/generated/client';

import { isPublishedEvent, toPublishedEvents, type FlatProperties } from '@common/events/outbox/published-events';
import type { BaseDomainEvent } from '@domains/common/events';

/** What one audited action records (DB Model §3 `audit_log`), before the request context is added. */
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

/** Published property prefixes that name a replaced value and its replacement (`previous_role` / `new_role`). */
const PREVIOUS = 'previous_';
const NEW = 'new_';

/**
 * Published events that are not operator actions: sign-ins, meters and trial clocks.
 *
 * `consent.recorded` is the data subject's own choice, arriving off the bus rather than from anyone in
 * the dashboard. `audit.logged` would audit the audit: every published event already becomes a row
 * here, so the event announcing that one exists must not produce a second one.
 */
const NOT_OPERATOR_ACTIONS = new Set([
    'user.logged_in',
    'usage.threshold_crossed',
    'usage.monthly_summary',
    'trial.reminder',
    'trial.expired',
    'consent.recorded',
    'audit.logged'
]);

/** Operator actions that are not published on the bus, keyed by in-process event type. */
const INTERNAL_ACTIONS: Record<string, (event: EventWithPayload) => Pick<AuditEntry, 'action' | 'targetType' | 'targetId'>> = {
    'tenant-setting.created': (e) => ({ action: 'tenant_setting.created', targetType: 'tenant_setting', targetId: e.aggregateId }),
    'tenant-setting.updated': (e) => ({ action: 'tenant_setting.updated', targetType: 'tenant_setting', targetId: e.aggregateId }),
    'api-key.updated': (e) => ({ action: 'api_key.updated', targetType: 'api_key', targetId: e.aggregateId }),
    'invitation.resent': (e) => ({ action: 'invitation.resent', targetType: 'invitation', targetId: e.aggregateId }),
    // US1.5.4 F2: every Owner read of the widget-token secret is on the trail.
    'tenant.widget_secret_revealed': (e) => ({ action: 'tenant.widget_secret_revealed', targetType: 'tenant', targetId: e.aggregateId }),
    // US1.8.2 F9: the two plan actions that are not published.
    'subscription.downgrade-cancelled': (e) => ({ action: 'subscription.downgrade_cancelled', targetType: 'subscription', targetId: e.aggregateId }),
    'subscription.reactivated': (e) => ({ action: 'subscription.reactivated', targetType: 'subscription', targetId: e.aggregateId }),
    'dns.reserved': (e) => ({ action: 'subdomain.reserved', targetType: 'subdomain', targetId: String(e.payload?.slug ?? e.aggregateId) }),
    'dns.released': (e) => ({ action: 'subdomain.released', targetType: 'subdomain', targetId: String(e.payload?.slug ?? e.aggregateId) })
};

/**
 * The principal behind an event: the user who acted, or `system` for a change nobody in the dashboard made
 * (a Stripe webhook, dunning, a scheduled job). US1.9.1 F4 / US1.8.2 F9: those changes alter what a tenant
 * may do, so they belong on the trail too; `NOT_OPERATOR_ACTIONS` keeps the noise out.
 */
export function auditActor(event: BaseDomainEvent): string {
    return event.userId || 'system';
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
            ...(changes ? splitChanges(changes) : splitReplaced(draft.properties))
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

/**
 * A published event that names what it replaced (`previous_role`, `previous_owner_id`, `previous_plan`, …) reads
 * like any other change (US1.9.1 F7): `before` holds the replaced values, `after` the rest with `new_<field>`
 * under the same `<field>` name. Without a `previous_` property, `after` is the properties as published.
 */
function splitReplaced(properties: FlatProperties): Pick<AuditEntry, 'before' | 'after'> {
    const replaced = Object.keys(properties).filter((key) => key.startsWith(PREVIOUS));
    if (replaced.length === 0) {
        return { before: null, after: properties };
    }
    const before: FlatProperties = {};
    const after: FlatProperties = { ...properties };
    for (const key of replaced) {
        const field = key.slice(PREVIOUS.length);
        before[field] = properties[key] ?? null;
        delete after[key];
        if (`${NEW}${field}` in after) {
            after[field] = after[`${NEW}${field}`] ?? null;
            delete after[`${NEW}${field}`];
        }
    }
    return { before, after };
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
