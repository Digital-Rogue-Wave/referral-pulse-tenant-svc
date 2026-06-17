import { BaseResponseMapper } from '@common/helper';

import { TotoResponse } from '@domains/toto';
import { TotoProps } from '../toto.types';

/**
 * Response Mapper for Toto entity
 *
 * Extends BaseResponseMapper to get all standard mapping methods for free:
 * - toResponse(entity) → TotoResponse
 * - toResponseArray(entities) → TotoResponse[]
 * - toListResponse(entity, fields) → Pick<TotoResponse, ...fields>
 * - toPublicResponse(entity, excludeFields) → Omit<TotoResponse, ...excludeFields>
 * - toMinimalResponse(entity) → Pick<TotoResponse, 'id' | 'name'>
 *
 * @example
 * ```typescript
 * // In your service
 * const mapper = new TotoResponseMapper();
 *
 * // Full response
 * const response = mapper.toResponse(TotoProps);
 *
 * // Array
 * const responses = mapper.toResponseArray(totoEntities);
 *
 * // List view (only specific fields)
 * const listItem = mapper.toListResponse(TotoProps, ['id', 'name', 'status']);
 *
 * // Public API (exclude internal fields)
 * const publicData = mapper.toPublicResponse(TotoProps, ['tenantId', 'externalData']);
 *
 * // Dropdown option
 * const option = mapper.toMinimalResponse(TotoProps);
 * ```
 */
export class TotoResponseMapper extends BaseResponseMapper<TotoProps, TotoResponse> {
    constructor() {
        super(TotoResponse);
    }

    /**
     * Override toMinimalResponse to include 'name' field
     * Perfect for dropdowns and autocomplete
     */
    override toMinimalResponse<K extends keyof TotoResponse = 'id' | 'name'>(entity: TotoProps): Pick<TotoResponse, K> {
        return this.toListResponse(entity, ['id', 'name'] as K[]);
    }

    /**
     * Predefined list response for Toto entities
     * Shows essential fields for list views
     */
    toListResponse(entity: TotoProps): Pick<TotoResponse, 'id' | 'name' | 'status' | 'createdAt'>;
    toListResponse<K extends keyof TotoResponse>(entity: TotoProps, fields: K[]): Pick<TotoResponse, K>;
    toListResponse<K extends keyof TotoResponse>(entity: TotoProps, fields?: K[]): Pick<TotoResponse, K> {
        // Default list fields if not specified
        const defaultFields = ['id', 'name', 'status', 'createdAt'] as K[];
        return super.toListResponse(entity, fields || defaultFields);
    }

    /**
     * Predefined public response for Toto entities
     * Excludes internal/sensitive fields by default
     */
    toPublicResponse<K extends keyof TotoResponse = 'tenantId' | 'externalData'>(entity: TotoProps, excludeFields?: K[]): Omit<TotoResponse, K> {
        const defaultExclude = ['tenantId', 'externalData'] as K[];
        return super.toPublicResponse(entity, excludeFields || defaultExclude);
    }

    /**
     * Example: Custom method for specific use case
     * Add summary response with computed fields
     */
    toSummaryResponse(entity: TotoProps): Pick<TotoResponse, 'id' | 'name' | 'status' | 'processCount'> {
        return this.toListResponse(entity, ['id', 'name', 'status', 'processCount']);
    }

    /**
     * Example: Custom transformation
     * Override toResponse if you need to add computed fields or transformations
     */
    // toResponse(entity: TotoProps): TotoResponse {
    //     const response = super.toResponse(entity);
    //
    //     // Add computed fields
    //     // response.computedField = entity.field1 + entity.field2;
    //
    //     // Transform dates
    //     // response.createdAt = entity.createdAt.toISOString() as any;
    //
    //     return response;
    // }
}

/**
 * Singleton instance for convenience
 * Import this directly in your services
 *
 * @example
 * ```typescript
 * import { totoResponseMapper } from '@domains/toto/mappers/toto-response.mapper';
 *
 * const response = totoResponseMapper.toResponse(entity);
 * ```
 */
export const totoResponseMapper = new TotoResponseMapper();
