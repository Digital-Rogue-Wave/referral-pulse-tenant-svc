import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import type { IAuthenticatedUser } from '@app/types';

export interface UserMeResponse {
    userId: string;
    tenantId: string;
    email: string | null;
    name: string | null;
    roles: string[];
    scopes: string[];
}

/**
 * Read-side for the platform user (referralai_api_contract — /v1/users/me).
 * Resolves the current user's profile + roles/scopes from the user projection.
 */
@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(UsersService.name);
    }

    async getMe(user: IAuthenticatedUser): Promise<UserMeResponse> {
        const record = await this.prisma.user.findUnique({
            where: { tenantId_kratosIdentityId: { tenantId: user.tenantId, kratosIdentityId: user.userId } },
            include: { userRoles: { include: { role: true } } }
        });

        const roles = record?.userRoles.map((ur) => ur.role.name) ?? [];
        const scopes = [...new Set(record?.userRoles.flatMap((ur) => (ur.role.scopes as string[]) ?? []) ?? [])];

        return {
            userId: user.userId,
            tenantId: user.tenantId,
            email: record?.email ?? user.email ?? null,
            name: record?.name ?? null,
            roles,
            scopes
        };
    }
}
