import { createHash } from 'crypto';

/** SHA-256 hex of a secret or identifier — for lookups and references that must never hold the raw value. */
export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Canonical email hash (DB Model v2 `email_hash`): case-insensitive, so one address always maps to one hash. */
export const hashEmail = (email: string): string => sha256Hex(email.trim().toLowerCase());
