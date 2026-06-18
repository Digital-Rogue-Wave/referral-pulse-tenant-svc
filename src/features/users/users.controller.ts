import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Paginate, PaginateQuery, Paginated, ApiPaginationQuery } from '@common/nestjs-prisma-pagination';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { AddUserDto, UpdateUserRoleDto, UserResponse } from '@domains/user';

import { UsersService, UserMeResponse } from './users.service';
import { USER_PAGINATE_CONFIG } from './users.pagination';

/**
 * Platform users (operators) — tenant membership + role per referralai_api_contract.
 * Replaces the former /team-members surface; users/roles/user_roles is the system of record.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get('me')
    @ApiOperation({ summary: 'Get the current user profile, roles and scopes' })
    @ApiOkResponse({ description: 'The authenticated user profile' })
    async getMe(@CurrentUser() user: IAuthenticatedUser): Promise<UserMeResponse> {
        return this.usersService.getMe(user);
    }

    @ApiBody({ type: AddUserDto })
    @ApiCreatedResponse({ description: 'User added to the tenant', type: UserResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.CREATE })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    async add(@Body() dto: AddUserDto, @CurrentUser() user: IAuthenticatedUser): Promise<UserResponse> {
        return this.usersService.addUser(user.userId, dto);
    }

    @ApiPaginationQuery(USER_PAGINATE_CONFIG)
    @ApiOkResponse({ description: 'List of platform users', type: UserResponse, isArray: true })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<UserResponse>> {
        return this.usersService.findAll(query);
    }

    @ApiOkResponse({ description: 'User details', type: UserResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<UserResponse> {
        return this.usersService.findById(id);
    }

    @ApiBody({ type: UpdateUserRoleDto })
    @ApiOkResponse({ description: 'User role updated', type: UserResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    @Put(':id/roles')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto, @CurrentUser() user: IAuthenticatedUser): Promise<UserResponse> {
        return this.usersService.updateRole(id, user.userId, dto);
    }

    @ApiOkResponse({ description: 'User removed from the tenant' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.USER, relation: KetoRelation.DELETE })
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async remove(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<void> {
        await this.usersService.remove(id, user.userId);
    }
}
