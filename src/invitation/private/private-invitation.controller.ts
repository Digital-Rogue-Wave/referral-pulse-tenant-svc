import { Controller, Post, Body, Param, UseGuards, HttpCode, HttpStatus, UseInterceptors, Delete } from '@nestjs/common';
import { PrivateInvitationService } from './private-invitation.service';
import { CreateInvitationDto } from '../dto/create-invitation.dto';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { InvitationEntity } from '../invitation.entity';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { InvitationDto } from '../dto/invitation.dto';
import { MapInterceptor } from '@automapper/nestjs';

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller({ path: 'invitations', version: '1' })
export class PrivateInvitationController {
    constructor(private readonly invitationService: PrivateInvitationService) {}

    @ApiBody({ type: CreateInvitationDto })
    @ApiCreatedResponse({ type: InvitationDto, description: 'The invitation has been successfully created' })
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.INVITE })
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async invite(@Body() createInvitationDto: CreateInvitationDto): Promise<InvitationEntity> {
        return this.invitationService.create(createInvitationDto);
    }

    @ApiOkResponse({ description: 'The invitation has been successfully revoked' })
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.INVITE })
    @HttpCode(HttpStatus.OK)
    @Delete(':invitationId')
    async revoke(@Param('invitationId') invitationId: string): Promise<void> {
        return this.invitationService.revoke(invitationId);
    }
}
