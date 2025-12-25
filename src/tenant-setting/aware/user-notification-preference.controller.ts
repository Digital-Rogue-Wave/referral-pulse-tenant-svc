import { Controller, Get, Body, Put, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiBody, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { UserNotificationPreferenceService } from './user-notification-preference.service';
import { UpdateUserNotificationPreferenceDto } from '../dto/update-user-notification-preference.dto';
import { UserNotificationPreferenceEntity } from '../user-notification-preference.entity';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { CurrentUser, CurrentUserType } from '@mod/common/auth/current-user.decorator';

@ApiTags('Notification Preferences')
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' }
})
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/notification-preferences', version: '1' })
export class UserNotificationPreferenceController {
    constructor(private readonly service: UserNotificationPreferenceService) {}

    @Get()
    @ApiOkResponse({ description: 'Get my notification preferences', type: UserNotificationPreferenceEntity })
    @HttpCode(HttpStatus.OK)
    async getMyPreferences(@CurrentUser() user: CurrentUserType): Promise<UserNotificationPreferenceEntity> {
        return await this.service.getMyPreferences(user);
    }

    @Put()
    @ApiBody({ type: UpdateUserNotificationPreferenceDto })
    @ApiOkResponse({ description: 'Update my notification preferences', type: UserNotificationPreferenceEntity })
    @HttpCode(HttpStatus.OK)
    async updateMyPreferences(
        @CurrentUser() user: CurrentUserType,
        @Body() updateDto: UpdateUserNotificationPreferenceDto
    ): Promise<UserNotificationPreferenceEntity> {
        return await this.service.updateMyPreferences(user, updateDto);
    }
}
