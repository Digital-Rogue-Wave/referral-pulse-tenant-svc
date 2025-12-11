import { Controller, Get, Put, Body, Query, Param, UseInterceptors, HttpCode, HttpStatus, HttpException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { MapInterceptor } from '@automapper/nestjs';
import { InvitationEntity } from '../invitation.entity';
import { InvitationDto } from '../dto/invitation.dto';
import { EditInvitationDto } from '../dto/accept-invitation.dto';
import { PublicInvitationService } from './public-invitation.service';
import { CurrentUser, CurrentUserType } from '@mod/common/auth/current-user.decorator';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';

@ApiTags('Public Invitations')
@Controller({ path: 'invitations/public', version: '1' })
export class PublicInvitationController {
    constructor(private readonly invitationService: PublicInvitationService) {}

    @ApiOkResponse({ type: InvitationDto, description: 'The invitation has been successfully validated' })
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.OK)
    @Get('invites/:token/validate')
    async validate(@Param('token') token: string): Promise<InvitationEntity> {
        return this.invitationService.validate(token);
    }

    @ApiBody({ type: EditInvitationDto })
    @ApiOkResponse({ type: InvitationDto, description: 'The invitation has been successfully accepted or rejected' })
    @ApiQuery({ name: 'action', enum: ['accept', 'reject'], description: 'Action to perform on the invitation' })
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.OK)
    @Put('invites')
    async respond(
        @Body() editInvitationDto: EditInvitationDto,
        @CurrentUser() user: CurrentUserType,
        @Query('action') action: 'accept' | 'reject'
    ): Promise<InvitationEntity> {
        if (action === 'accept') {
            return this.invitationService.accept(editInvitationDto.token, user.id);
        } else if (action === 'reject') {
            return this.invitationService.reject(editInvitationDto.token);
        } else {
            throw new HttpException({ message: 'Invalid action', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }
    }
}
