/**
 * Toto interface matching the Prisma model definition
 * This serves as the domain entity for the Toto feature
 */
export type TotoProps = {
    id: string;
    tenantId: string;
    name: string;
    description?: string | null;
    status: string;
    processCount: number;
    fileUrl?: string | null;
    externalData?: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
};

/**
 * SQS message payload for toto.created events
 */
export interface TotoCreatedPayload {
    totoId: string;
    name: string;
    tenantId: string;
    status: string;
    createdAt: Date;
}

/**
 * SQS message payload for toto.updated events
 */
export interface TotoUpdatedPayload {
    totoId: string;
    name?: string;
    status?: string;
    tenantId: string;
    updatedAt: Date;
    changes?: Record<string, { from: unknown; to: unknown }>;
}
