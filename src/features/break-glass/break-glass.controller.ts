import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IAuthenticatedUser } from '@app/types';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { PlatformAdmin } from '@common/auth/require-permission.decorator';
import { BreakGlassResponse, OpenBreakGlassDto } from '@domains/break-glass';

import { BreakGlassService } from './break-glass.service';

/**
 * Break-glass (Product Spec R-ACT-02, E1 D17). Super Admins only, from the platform console. Opening a window gives no
 * token by itself: the console then sends `X-Break-Glass-Tenant` with its requests, and the gateway's token exchange
 * turns each one into a short-lived read-only token for that tenant and audits it.
 */
@ApiTags('Admin - Break-glass')
@ApiBearerAuth()
@PlatformAdmin()
@Controller({ path: 'admin/break-glass', version: '1' })
export class BreakGlassController {
    constructor(private readonly breakGlass: BreakGlassService) {}

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: "Open one hour of audited, read-only access to a tenant's data" })
    @ApiCreatedResponse({ type: BreakGlassResponse })
    async open(@Body() dto: OpenBreakGlassDto, @CurrentUser() user: IAuthenticatedUser): Promise<BreakGlassResponse> {
        return this.breakGlass.open(user.identityId as string, dto);
    }
}
