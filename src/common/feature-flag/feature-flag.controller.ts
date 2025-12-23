import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeatureFlagService } from './feature-flag.service';
import { ToggleFeatureFlagDto } from './dto/toggle-feature-flag.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Admin - Feature Flags')
@Controller({ path: 'admin/feature-flags', version: '1' })
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class FeatureFlagController {
    constructor(private readonly featureFlagService: FeatureFlagService) {}

    @Post('toggle')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Toggle feature flag for a specific tenant' })
    async toggleFeature(@Body() toggleDto: ToggleFeatureFlagDto): Promise<{ success: boolean }> {
        await this.featureFlagService.setOverride(toggleDto.key, toggleDto.tenantId, toggleDto.isEnabled);
        return { success: true };
    }
}
