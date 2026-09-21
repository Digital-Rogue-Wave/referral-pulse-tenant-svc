import { HttpStatus } from '@nestjs/common';

import { ROLE_RANK } from '@common/auth/authz/permission-catalog';
import { RoleEnum } from '@common/enums/role.enum';
import { BaseException } from '@common/exceptions/base.exceptions';

/**
 * Who may give or take which role.
 *
 * - OWNER is never granted directly — only by transferring ownership, which the current Owner does.
 * - Nobody grants a role above their own.
 * - Nobody changes or removes a member ranked at or above themselves (an Admin cannot demote another
 *   Admin), except the Owner, who outranks everyone.
 * - Nobody changes their own role.
 */
export const RoleGrantPolicy = {
    assertCanGrant(actorRole: RoleEnum, grantedRole: RoleEnum): void {
        if (grantedRole === RoleEnum.OWNER) {
            throw denied('The Owner role is only assigned by transferring ownership');
        }
        if (ROLE_RANK[grantedRole] > ROLE_RANK[actorRole]) {
            throw denied(`A ${actorRole} cannot grant the ${grantedRole} role`);
        }
    },

    assertCanManage(actorRole: RoleEnum, actorUserId: string, target: { id: string; role: RoleEnum }): void {
        if (target.id === actorUserId) {
            throw denied('You cannot change or remove your own membership');
        }
        if (actorRole !== RoleEnum.OWNER && ROLE_RANK[target.role] >= ROLE_RANK[actorRole]) {
            throw denied(`A ${actorRole} cannot manage a ${target.role}`);
        }
    }
};

function denied(message: string): BaseException {
    return new BaseException('insufficient_permissions', message, HttpStatus.FORBIDDEN);
}
