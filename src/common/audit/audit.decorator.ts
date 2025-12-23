import { SetMetadata } from '@nestjs/common';
import { AuditAction } from './audit-action.enum';

export const AUDIT_ACTION_KEY = 'audit_action';
export const Auditable = (action: AuditAction) => SetMetadata(AUDIT_ACTION_KEY, action);
