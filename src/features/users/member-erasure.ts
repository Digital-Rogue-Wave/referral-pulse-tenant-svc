import type { Prisma } from '@prisma-gen/generated/client';

import { hashEmail } from '@common/helper/hashing';

/**
 * Replacement values for an erased operator (API Contract v1.3 §8.3: PII is anonymised in place). The row
 * keeps its id so audit rows and other services' references stay valid; nothing left on it identifies a
 * person. The placeholder address uses the reserved `.invalid` TLD, so it can never be delivered.
 */
export function erasedMemberData(userId: string, erasedAt: Date): Prisma.UserUpdateInput {
    const email = `erased-${userId.toLowerCase()}@erased.invalid`;
    return {
        email,
        emailHash: hashEmail(email),
        name: null,
        kratosIdentityId: `erased:${userId}`,
        status: 'disabled',
        deletedAt: erasedAt
    };
}

/** True when the operator record was already erased (a retried erasure is a no-op). */
export const isErasedMember = (user: { kratosIdentityId: string }): boolean => user.kratosIdentityId.startsWith('erased:');
