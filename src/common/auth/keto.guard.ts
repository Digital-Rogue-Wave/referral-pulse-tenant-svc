import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata, Inject, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { KetoService } from './keto.service';
import { JwtPayload, KetoPermission } from '@mod/types/app.interface';

export const KETO_PERMISSION_KEY = 'ketoPermission';
export const RequirePermission = (permission: KetoPermission) => SetMetadata(KETO_PERMISSION_KEY, permission);

@Injectable()
export class KetoGuard implements CanActivate {
    private readonly logger = new Logger(KetoGuard.name);

    constructor(
        @Inject(Reflector) private readonly reflector: Reflector,
        private readonly keto: KetoService,
        private readonly cls: ClsService
    ) {
        this.logger.log('KetoGuard initialized');
        this.logger.log(`Reflector: ${!!this.reflector}`);
        this.logger.log(`KetoService: ${!!this.keto}`);
        this.logger.log(`ClsService: ${!!this.cls}`);
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const permission = this.reflector.getAllAndOverride<KetoPermission>(KETO_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

        if (!permission) {
            return true;
        }

        const req = context.switchToHttp().getRequest<Request>();
        const user = req.user as JwtPayload;

        if (!user || !user.sub) {
            throw new ForbiddenException('No authenticated user');
        }

        const isServiceToken = this.cls.get('isServiceToken') as boolean;

        // Service tokens can bypass Keto checks if allowed
        if (isServiceToken && permission.allowServiceTokens) {
            return true;
        }

        // For user tokens, check Keto permissions
        let object: string;
        if (permission.object) {
            object = permission.object;
        } else {
            const paramName = permission.objectParam ?? 'id';
            object = req.params[paramName];

            if (!object) {
                throw new ForbiddenException(`Missing route parameter: ${paramName}`);
            }
        }

        // Use sub for users, client_id for services
        const subjectId = isServiceToken ? user.client_id || user.sub : user.sub;

        const allowed = await this.keto.check(permission.namespace, object, permission.relation, subjectId);

        if (!allowed) {
            throw new ForbiddenException(`Missing permission: ${permission.namespace}:${object}#${permission.relation}`);
        }

        return true;
    }
}
