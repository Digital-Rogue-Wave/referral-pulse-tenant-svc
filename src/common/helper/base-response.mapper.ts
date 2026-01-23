import { toDto, toDtoArray, pick, omit } from './mapper.util';

/**
 * Type helper for class constructors
 */
type Class<T> = new (...args: any[]) => T;

/**
 * Base Response Mapper
 *
 * Generic, reusable mapper class for all entity-to-DTO mappings.
 * Provides common mapping methods out of the box.
 *
 * Benefits:
 * - Zero boilerplate for standard CRUD responses
 * - Type-safe with full IntelliSense support
 * - Consistent API across all mappers
 * - Easy to customize via method overriding
 * - Automatic array mapping
 *
 * @example
 * ```typescript
 * export class UserResponseMapper extends BaseResponseMapper<UserEntity, UserResponse> {
 *     constructor() {
 *         super(UserResponse);
 *     }
 *
 *     // That's it! You get toResponse, toResponseArray, etc. for free
 *     // Optionally override methods for custom behavior
 * }
 * ```
 *
 * @template TEntity - The entity class (e.g., UserEntity)
 * @template TResponse - The response DTO class (e.g., UserResponse)
 */
export abstract class BaseResponseMapper<TEntity extends object, TResponse extends object> {
    /**
     * The response class constructor
     * Set this in the child class constructor
     */
    protected responseClass: Class<TResponse>;

    constructor(responseClass: Class<TResponse>) {
        this.responseClass = responseClass;
    }

    /**
     * Maps a single entity to response DTO
     * Override this method for custom mapping logic
     *
     * @example
     * ```typescript
     * toResponse(entity: UserEntity): UserResponse {
     *     const response = super.toResponse(entity);
     *     response.fullName = `${entity.firstName} ${entity.lastName}`;
     *     return response;
     * }
     * ```
     */
    toResponse(entity: TEntity): TResponse {
        return toDto(this.responseClass, entity);
    }

    /**
     * Maps an array of entities to response DTOs
     * Automatically uses toResponse() for each entity
     */
    toResponseArray(entities: TEntity[]): TResponse[] {
        return entities.map((entity) => this.toResponse(entity));
    }

    /**
     * Maps to list response with only specified fields
     * Perfect for list views where you don't need all fields
     *
     * @example
     * ```typescript
     * const listItems = mapper.toListResponse(entities, ['id', 'name', 'status']);
     * ```
     */
    toListResponse<K extends keyof TResponse>(entity: TEntity, fields: K[]): Pick<TResponse, K> {
        const response = this.toResponse(entity);
        return pick(response, fields);
    }

    /**
     * Maps array to list responses
     */
    toListResponseArray<K extends keyof TResponse>(
        entities: TEntity[],
        fields: K[],
    ): Pick<TResponse, K>[] {
        return entities.map((entity) => this.toListResponse(entity, fields));
    }

    /**
     * Maps to public response by excluding specified fields
     * Use for public APIs or external integrations
     *
     * @example
     * ```typescript
     * const publicData = mapper.toPublicResponse(entity, ['tenantId', 'internalNotes']);
     * ```
     */
    toPublicResponse<K extends keyof TResponse>(
        entity: TEntity,
        excludeFields: K[],
    ): Omit<TResponse, K> {
        const response = this.toResponse(entity);
        return omit(response, excludeFields);
    }

    /**
     * Maps array to public responses
     */
    toPublicResponseArray<K extends keyof TResponse>(
        entities: TEntity[],
        excludeFields: K[],
    ): Omit<TResponse, K>[] {
        return entities.map((entity) => this.toPublicResponse(entity, excludeFields));
    }

    /**
     * Maps to minimal response (typically just id and name)
     * Perfect for dropdowns, autocomplete, and references
     *
     * Override this to define your standard minimal fields
     *
     * @example
     * ```typescript
     * toMinimalResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email'> {
     *     return this.toListResponse(entity, ['id', 'email']);
     * }
     * ```
     */
    toMinimalResponse<K extends keyof TResponse = any>(entity: TEntity): Pick<TResponse, K> {
        return this.toListResponse(entity, ['id'] as K[]);
    }

    /**
     * Maps array to minimal responses
     */
    toMinimalResponseArray<K extends keyof TResponse = any>(
        entities: TEntity[],
    ): Pick<TResponse, K>[] {
        return entities.map((entity) => this.toMinimalResponse(entity));
    }
}

/**
 * Convenience function to create a simple mapper instance
 * Use this when you don't need custom mapping logic
 *
 * @example
 * ```typescript
 * // One-liner to create a fully functional mapper
 * const userMapper = createMapper(UserResponse);
 *
 * // Use it
 * const response = userMapper.toResponse(userEntity);
 * const responses = userMapper.toResponseArray(userEntities);
 * ```
 */
export function createMapper<TEntity extends object, TResponse extends object>(
    responseClass: Class<TResponse>,
): BaseResponseMapper<TEntity, TResponse> {
    return new (class extends BaseResponseMapper<TEntity, TResponse> {
        constructor() {
            super(responseClass);
        }
    })();
}