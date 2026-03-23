import { BaseDomainEvent } from '@domains/common/events';

export class FileUploadedEvent extends BaseDomainEvent {
    readonly eventType = 'file.uploaded' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly path: string,
        public readonly mimeType: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

export class FileDeletedEvent extends BaseDomainEvent {
    readonly eventType = 'file.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly path: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

export const FileEvents = {
    UPLOADED: 'file.uploaded',
    DELETED: 'file.deleted',
} as const;