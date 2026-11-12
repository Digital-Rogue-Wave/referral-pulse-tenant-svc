/**
 * R-PRT-02's platform default for platform-sent invitations, per billing country — a maintained legal
 * artefact, not a product setting (E1 decision D9, US1.7.1 F5/F7). Legal changes these lists; nothing else
 * in the code needs to move.
 *
 * - `FORBIDDEN_BY_DEFAULT`: v5.1 names Germany (BGH 2013, Empfehlungs-E-Mail), the Netherlands and the Nordics.
 * - `ANALYSED_ALLOWED`: countries whose law has been reviewed and allows the channel under legitimate interest
 *   with minimisation. **Not in the spec — the list is a starting point for the legal team to confirm.**
 *
 * Any country in neither list, and a tenant whose country is not known yet, resolves to `forbidden` — the
 * lawful side — until the Owner chooses (not in the spec; to discuss).
 */
export const INVITATION_DEFAULTS_VERSION = '2026-11-12';

export const FORBIDDEN_BY_DEFAULT: readonly string[] = ['DE', 'NL', 'DK', 'SE', 'FI', 'NO', 'IS'];

export const ANALYSED_ALLOWED: readonly string[] = ['FR', 'ES', 'IT', 'BE', 'AT', 'IE', 'PT', 'LU'];
