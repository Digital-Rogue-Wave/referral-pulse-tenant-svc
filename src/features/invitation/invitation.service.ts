import { Injectable } from '@nestjs/common';

import { AppLoggerService } from '@common/logging/app-logger.service';

/**
 * Invitation Service
 * TODO: Implement invitation business logic (create, accept, resend, revoke)
 */
@Injectable()
export class InvitationService {
    constructor(private readonly logger: AppLoggerService) {
        this.logger.setContext(InvitationService.name);
    }
}
