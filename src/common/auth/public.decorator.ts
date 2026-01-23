import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './jwt-auth.guard';

/**
 * Decorator to mark routes as public (no authentication required).
 *
 * @example
 * ```typescript
 * @Controller('health')
 * export class HealthController {
 *   @Get()
 *   @Public()
 *   check() {
 *     return { status: 'ok' };
 *   }
 * }
 * ```
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
