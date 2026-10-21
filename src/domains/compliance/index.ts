import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';

import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Enums
// ============================================================

/** The three kinds Product Spec R-CPL-02 names: "A DSR (access, erasure, portability)". */
export enum DsrRequestType {
    ACCESS = 'access',
    ERASURE = 'erasure',
    PORTABILITY = 'portability'
}

/**
 * R-CPL-02 names the request types but not the lifecycle, so these are this service's.
 *
 * `accepted` is the resting state of an `access` or `portability` request: it is recorded, dated and
 * answerable, but the collect-and-package contract for the other six services does not exist in the v5
 * suite, so nothing is fanned out. Erasure is the one type that runs end to end today — the only one
 * R-CPL-02 specifies a fan-out for. Recorded in NOTE.md §V5.16.
 */
export enum DsrStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    ACCEPTED = 'accepted',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

/** Event Model §2.4 — `consent.tracking_consent` / `consent.marketing_consent`. */
export enum ConsentStatus {
    GRANTED = 'granted',
    DENIED = 'denied',
    PENDING = 'pending'
}

/** Event Model §2.4 — `consent.consent_source`. */
export enum ConsentSource {
    CMP_BANNER = 'cmp_banner',
    SIGNUP_FORM = 'signup_form',
    API = 'api',
    WIDGET = 'widget',
    INHERITED = 'inherited'
}

/** Per-service outcome. `pending` is a target that has not answered yet, so a retry resumes there. */
export enum DsrReceiptStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    PARTIAL = 'partial',
    FAILED = 'failed'
}

/**
 * API Contract §3.15: "Processed within 30 days". R-CPL-02 says "within the client's legal deadline (one
 * month)" — the same deadline stated two ways, and 30 days is the one with a number, so it is the one
 * stamped on the row. A tenant-configurable deadline is not in the v5 suite.
 */
export const DSR_DEADLINE_DAYS = 30;

export const dsrDueAt = (from: Date): Date => new Date(from.getTime() + DSR_DEADLINE_DAYS * 86_400_000);

// ============================================================
// Props (shape of the Prisma models)
// ============================================================

export interface DsrReceiptProps {
    id: string;
    dsrRequestId: string;
    tenantId: string;
    serviceName: string;
    status: string;
    receipt: unknown;
    retainedUnderObligation: boolean;
    receivedAt: Date;
}

export interface DsrRequestProps {
    id: string;
    tenantId: string;
    subjectId: string | null;
    subjectEmailHash: string | null;
    subjectExternalId: string | null;
    requestType: string;
    status: string;
    requestedBy: string | null;
    dueAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    receipts?: DsrReceiptProps[];
}

export interface ConsentProps {
    id: string;
    tenantId: string;
    subjectId: string | null;
    subjectEmailHash: string | null;
    subjectExternalId: string | null;
    trackingConsent: string;
    marketingConsent: string | null;
    consentSource: string | null;
    recordedAt: Date;
    withdrawnAt: Date | null;
}

// ============================================================
// DTOs
// ============================================================

/**
 * `POST /v1/dsr`, named by API Contract §3.15 with no body specified, so this shape is this service's
 * proposal rather than a contract being implemented (NOTE.md §V5.16).
 *
 * The subject is named by whichever identifier the Owner has. `subjectEmail` is hashed on arrival and
 * the address itself is never stored — which is also why an erasure can be submitted for a subject this
 * service has never heard of: the hash is what the other six services match on.
 */
export class CreateDsrDto {
    @ApiProperty({ enum: DsrRequestType })
    @IsEnum(DsrRequestType)
    requestType!: DsrRequestType;

    @ApiPropertyOptional({ description: 'The subject’s email address. Hashed on arrival; never stored or logged in the clear.' })
    @ValidateIf((dto: CreateDsrDto) => !dto.subjectExternalId && !dto.subjectId)
    @IsEmail()
    subjectEmail?: string;

    @ApiPropertyOptional({ description: 'The client’s own identifier for the subject' })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    subjectExternalId?: string;

    @ApiPropertyOptional({ description: 'The platform participant/invitee id, when the Owner already knows it' })
    @IsOptional()
    @IsString()
    @Length(26, 26)
    subjectId?: string;
}

// ============================================================
// Responses
// ============================================================

export class DsrReceiptResponse {
    @ApiProperty({ example: 'reward-service' })
    serviceName!: string;

    @ApiProperty({ enum: DsrReceiptStatus })
    status!: string;

    @ApiProperty({ description: 'What the service erased, as it reported it' })
    receipt!: unknown;

    @ApiProperty({ description: 'The service kept rows it is legally obliged to keep — R-CPL-02’s ledger exception' })
    retainedUnderObligation!: boolean;

    @ApiProperty()
    receivedAt!: Date;
}

export class DsrRequestResponse {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: DsrRequestType })
    requestType!: string;

    @ApiProperty({ enum: DsrStatus })
    status!: string;

    @ApiPropertyOptional({ nullable: true, type: String, description: 'SHA-256 of the lower-cased address — the only form stored' })
    subjectEmailHash!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String })
    subjectExternalId!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String })
    subjectId!: string | null;

    @ApiPropertyOptional({ nullable: true, type: String, description: 'The Owner who submitted it' })
    requestedBy!: string | null;

    @ApiProperty({ description: `Legal deadline — submitted + ${DSR_DEADLINE_DAYS} days (API §3.15)` })
    dueAt!: Date;

    @ApiPropertyOptional({ nullable: true, type: Date })
    completedAt!: Date | null;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty({ type: [DsrReceiptResponse], description: 'One per service that has answered; R-CPL-02’s proof of erasure' })
    receipts!: DsrReceiptResponse[];
}

export const toDsrReceiptResponse = (row: DsrReceiptProps): DsrReceiptResponse => ({
    serviceName: row.serviceName,
    status: row.status,
    receipt: row.receipt ?? null,
    retainedUnderObligation: row.retainedUnderObligation,
    receivedAt: row.receivedAt
});

export const toDsrRequestResponse = (row: DsrRequestProps): DsrRequestResponse => ({
    id: row.id,
    tenantId: row.tenantId,
    requestType: row.requestType,
    status: row.status,
    subjectEmailHash: row.subjectEmailHash,
    subjectExternalId: row.subjectExternalId,
    subjectId: row.subjectId,
    requestedBy: row.requestedBy,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    receipts: (row.receipts ?? []).map(toDsrReceiptResponse)
});

// ============================================================
// Domain Events
// ============================================================

export const ComplianceEvents = {
    CONSENT_RECORDED: 'consent.recorded',
    DSR_REQUESTED: 'dsr.requested',
    ERASURE_COMPLETED: 'erasure.completed',
    AUDIT_LOGGED: 'audit.logged'
} as const;

/**
 * Product Spec R-CPL-01 calls `consent.recorded`, `dsr.requested`, `erasure.completed` and
 * `audit.logged` "the Event Model compliance family". They appear nowhere in the Event Model — no
 * payload, no object type, no schema version — so the four shapes below are this service's, derived
 * from what R-CPL-02 says each one has to carry. Sent back as a spec patch; see NOTE.md §V5.16.
 */
export class ConsentRecordedEvent extends BaseDomainEvent {
    readonly eventType = ComplianceEvents.CONSENT_RECORDED;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            subjectEmailHash: string | null;
            subjectExternalId: string | null;
            trackingConsent: string;
            marketingConsent: string | null;
            consentSource: string | null;
            recordedAt: Date;
        }
    ) {
        super();
    }
}

export class DsrRequestedEvent extends BaseDomainEvent {
    readonly eventType = ComplianceEvents.DSR_REQUESTED;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            requestType: string;
            subjectEmailHash: string | null;
            subjectExternalId: string | null;
            subjectId: string | null;
            dueAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

/** One receipt as it travels on the bus — R-CPL-02: "erasure.completed carries all receipts". */
export interface ErasureReceiptSummary {
    service: string;
    status: string;
    retained_under_obligation: boolean;
}

export class ErasureCompletedEvent extends BaseDomainEvent {
    readonly eventType = ComplianceEvents.ERASURE_COMPLETED;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            subjectEmailHash: string | null;
            subjectExternalId: string | null;
            completedAt: Date;
            receipts: ErasureReceiptSummary[];
        }
    ) {
        super();
    }
}

/**
 * R-CPL-02's last step: "erasure.completed — audit.logged with per-service receipts; subject informed".
 * Published only for a compliance record, not for every operator action: every published event already
 * becomes an `audit_log` row (`AuditLogWriter`), so a per-row event would be a firehose and would audit
 * itself. This one announces that the compliance record exists and where to read it.
 */
export class ComplianceAuditLoggedEvent extends BaseDomainEvent {
    readonly eventType = ComplianceEvents.AUDIT_LOGGED;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            action: string;
            subjectEmailHash: string | null;
            receiptCount: number;
            recordUrl: string;
        }
    ) {
        super();
    }
}
