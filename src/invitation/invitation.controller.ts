import {
    Controller,
    Post,
    Body,
    Param,
    Get,
    UseGuards,
    Req,
    HttpCode,
    HttpStatus,
    UseInterceptors,
    Put,
    Query,
    HttpException,
    Delete
} from '@nestjs/common';
import { Request } from 'express';
import { InvitationService } from './invitation.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { EditInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { InvitationEntity } from './invitation.entity';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { InvitationDto } from './dto/invitation.dto';
import { MapInterceptor } from '@automapper/nestjs';

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller({ path: 'invitations', version: '1' })
export class InvitationController {
    constructor(private readonly invitationService: InvitationService) {}

    @ApiBody({ type: CreateInvitationDto })
    @ApiCreatedResponse({ type: InvitationDto, description: 'The invitation has been successfully created' })
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.INVITE, objectParam: 'id' })
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.CREATED)
    @Post('tenants/:id/invites')
    async invite(@Param('id') tenantId: string, @Body() createInvitationDto: CreateInvitationDto): Promise<InvitationEntity> {
        return this.invitationService.create(tenantId, createInvitationDto);
    }

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
        @Req() req: Request,
        @Query('action') action: 'accept' | 'reject'
    ): Promise<InvitationEntity> {
        if (action === 'accept') {
            const userId = req.user?.sub;
            if (!userId) {
                throw new HttpException({ message: 'User not authenticated', code: HttpStatus.UNAUTHORIZED }, HttpStatus.UNAUTHORIZED);
            }
            return this.invitationService.accept(editInvitationDto.token, userId);
        } else if (action === 'reject') {
            return this.invitationService.reject(editInvitationDto.token);
        } else {
            throw new HttpException({ message: 'Invalid action', code: HttpStatus.BAD_REQUEST }, HttpStatus.BAD_REQUEST);
        }
    }

    @ApiOkResponse({ description: 'The invitation has been successfully revoked' })
    @UseGuards(JwtAuthGuard, KetoGuard)
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.INVITE, objectParam: 'id' })
    @HttpCode(HttpStatus.OK)
    @Delete('tenants/:id/invites/:invitationId')
    async revoke(@Param('invitationId') invitationId: string): Promise<void> {
        return this.invitationService.revoke(invitationId);
    }
}
