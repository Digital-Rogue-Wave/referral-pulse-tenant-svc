import { Controller, Post, Body, Param, UseGuards, HttpCode, HttpStatus, UseInterceptors, Delete, Get } from '@nestjs/common';
import { AwareInvitationService } from './aware-invitation.service';
import { CreateInvitationDto } from '../dto/create-invitation.dto';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { InvitationEntity } from '../invitation.entity';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { InvitationDto } from '../dto/invitation.dto';
import { InjectMapper, MapInterceptor } from '@automapper/nestjs';
import { NullableType } from '@mod/types/nullable.type';
import { invitationPaginationConfig } from '../config/invitation-pagination-config';
import { ApiPaginationQuery, Paginate, PaginateQuery } from 'nestjs-paginate';
import { PaginatedDto } from '@mod/common/serialization/paginated.dto';
import { Mapper } from '@automapper/core';

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, KetoGuard)
@Controller({ path: 'invitations', version: '1' })
export class AwareInvitationController {
    constructor(
        private readonly invitationService: AwareInvitationService,
        @InjectMapper() private readonly mapper: Mapper
    ) {}

    @ApiBody({ type: CreateInvitationDto })
    @ApiCreatedResponse({ type: InvitationDto, description: 'The invitation has been successfully created' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.INVITE })
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async invite(@Body() createInvitationDto: CreateInvitationDto): Promise<InvitationEntity> {
        return this.invitationService.create(createInvitationDto);
    }

    @ApiPaginationQuery(invitationPaginationConfig)
    @ApiOkResponse({ type: PaginatedDto<InvitationEntity, InvitationDto>, description: 'The invitations have been successfully retrieved' })
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.OK)
    @Get()
    async listInvitations(@Paginate() query: PaginateQuery): Promise<PaginatedDto<InvitationEntity, InvitationDto>> {
        const invitations = await this.invitationService.findAll(query);
        return new PaginatedDto<InvitationEntity, InvitationDto>(this.mapper, invitations, InvitationEntity, InvitationDto);
    }

    @ApiOkResponse({ type: InvitationDto, description: 'The invitation has been successfully validated' })
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async validate(@Param('id') invitationId: string): Promise<NullableType<InvitationEntity>> {
        return this.invitationService.findOne({ id: invitationId });
    }

    @ApiOkResponse({ description: 'The invitation has been successfully revoked' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.INVITE })
    @HttpCode(HttpStatus.OK)
    @Delete(':id')
    async revoke(@Param('id') invitationId: string): Promise<void> {
        return this.invitationService.revoke(invitationId);
    }

    @ApiOkResponse({ type: InvitationDto, description: 'The invitation has been successfully resent' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.INVITE })
    @UseInterceptors(MapInterceptor(InvitationEntity, InvitationDto))
    @HttpCode(HttpStatus.OK)
    @Post(':id/resend')
    async resend(@Param('id') invitationId: string): Promise<InvitationEntity> {
        return this.invitationService.resend(invitationId);
    }
}
