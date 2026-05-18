import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { InvitationService } from './invitation.service';

/**
 * Invitation Controller (tenant-aware)
 * TODO: Add invitation management endpoints (create, list, revoke, resend)
 */
@ApiTags('Invitations')
@Controller({ path: 'invitations', version: '1' })
export class InvitationController {
    constructor(private readonly invitationService: InvitationService) {}
}

/**
 * Public Invitation Controller
 * TODO: Add public endpoints (accept, validate token)
 */
@ApiTags('Public - Invitations')
@Controller({ path: 'invitations/public', version: '1' })
export class PublicInvitationController {
    constructor(private readonly invitationService: InvitationService) {}
}
