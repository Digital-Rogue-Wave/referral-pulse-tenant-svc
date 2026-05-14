import { Controller, Get, Put, Delete, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse, ApiHeader, ApiBody } from '@nestjs/swagger';

import { Idempotent, IdempotencyScope } from '@common/idempotency';
import { UpdateUserNotificationPreferenceDto, UserNotificationPreferenceResponse } from '@domains/tenant-setting';

import { UserNotificationPreferenceService } from './user-notification-preference.service';

@ApiTags('User Notification Preferences')
@ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant ID header',
    schema: { type: 'string' },
})
@Controller({ path: 'me/notification-preferences', version: '1' })
@ApiBearerAuth()
export class UserNotificationPreferenceController {
    constructor(private readonly userNotificationPreferenceService: UserNotificationPreferenceService) {}

    @ApiOkResponse({
        description: 'Current user notification preferences',
        type: UserNotificationPreferenceResponse,
    })
    @HttpCode(HttpStatus.OK)
    @Get()
    async findMyPreferences(): Promise<UserNotificationPreferenceResponse | null> {
        return this.userNotificationPreferenceService.findMyPreferences();
    }

    @ApiBody({ type: UpdateUserNotificationPreferenceDto })
    @ApiOkResponse({
        description: 'Notification preferences updated successfully',
        type: UserNotificationPreferenceResponse,
    })
    @HttpCode(HttpStatus.OK)
    @Put()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async updateMyPreferences(
        @Body() dto: UpdateUserNotificationPreferenceDto,
    ): Promise<UserNotificationPreferenceResponse> {
        return this.userNotificationPreferenceService.updateMyPreferences(dto);
    }

    @ApiOkResponse({
        description: 'Notification preferences deleted successfully',
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async deleteMyPreferences(): Promise<void> {
        await this.userNotificationPreferenceService.deleteMyPreferences();
    }
}
