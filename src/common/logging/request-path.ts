/** A request URL without its query string — query strings can carry invitation and verification tokens. */
export const pathOf = (url: string | undefined): string => (url ?? '').split('?')[0]!;
