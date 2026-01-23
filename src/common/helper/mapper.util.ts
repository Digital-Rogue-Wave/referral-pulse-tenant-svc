/**
 * Type helper for class constructors
 */
type Class<T> = new (...args: any[]) => T;

/**
 * Fields commonly excluded when mapping from DTO to Entity
 * These are typically auto-generated or managed by the database
 */
const DEFAULT_PROTECTED_FIELDS = new Set<string>([
    'id',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'version',
]);

/**
 * Mapper configuration options
 */
interface MapperOptions<T = any> {
    /**
     * Fields to exclude from mapping
     */
    exclude?: (keyof T)[];

    /**
     * Fields to include (if specified, only these fields are mapped)
     */
    include?: (keyof T)[];

    /**
     * Custom field transformers
     * @example { createdAt: (val) => val.toISOString() }
     */
    transform?: Partial<Record<keyof T, (value: any) => any>>;

    /**
     * Skip undefined values (useful for PATCH operations)
     * @default false
     */
    skipUndefined?: boolean;

    /**
     * Skip null values
     * @default false
     */
    skipNull?: boolean;

    /**
     * Deep clone nested objects
     * @default false
     */
    deepClone?: boolean;
}

/**
 * Maps an entity to a DTO/Response object
 *
 * @example
 * const response = toDto(TotoResponse, entity);
 * const partialResponse = toDto(TotoResponse, entity, { include: ['id', 'name'] });
 * const transformed = toDto(TotoResponse, entity, {
 *   transform: { createdAt: (d) => d.toISOString() }
 * });
 */
export function toDto<TSource extends object, TTarget extends object>(
    TargetClass: Class<TTarget>,
    source: TSource,
    options?: MapperOptions<TTarget>,
): TTarget {
    const target = new TargetClass();
    return mapProperties(source, target, options);
}

/**
 * Maps a DTO to an entity
 *
 * @example
 * const entity = toEntity(TotoEntity, createDto);
 */
export function toEntity<TSource extends object, TTarget extends object>(
    EntityClass: Class<TTarget>,
    source: TSource,
    options?: MapperOptions<TTarget>,
): TTarget {
    const entity = new EntityClass();
    // By default, exclude protected fields when mapping to entity
    const opts: MapperOptions<TTarget> = {
        ...options,
        exclude: [
            ...(options?.exclude || []),
            ...Array.from(DEFAULT_PROTECTED_FIELDS),
        ] as (keyof TTarget)[],
    };
    return mapProperties(source, entity, opts);
}

/**
 * Patches an existing entity with data from a DTO (for PATCH/UPDATE operations)
 * - Skips undefined values by default (partial updates)
 * - Protects system-managed fields by default
 *
 * @example
 * const updated = patchEntity(existingEntity, updateDto);
 * const updated = patchEntity(existingEntity, updateDto, {
 *   exclude: ['status'], // additional fields to protect
 * });
 */
export function patchEntity<TSource extends object, TTarget extends object>(
    target: TTarget,
    source: Partial<TSource>,
    options?: MapperOptions<TTarget>,
): TTarget {
    const opts: MapperOptions<TTarget> = {
        skipUndefined: true,
        ...options,
        exclude: [
            ...(options?.exclude || []),
            ...Array.from(DEFAULT_PROTECTED_FIELDS),
        ] as (keyof TTarget)[],
    };
    return mapProperties(source, target, opts);
}

/**
 * Maps an array of entities to DTOs
 *
 * @example
 * const responses = toDtoArray(TotoResponse, entities);
 */
export function toDtoArray<TSource extends object, TTarget extends object>(
    TargetClass: Class<TTarget>,
    sources: TSource[],
    options?: MapperOptions<TTarget>,
): TTarget[] {
    return sources.map((source) => toDto(TargetClass, source, options));
}

/**
 * Maps an array of DTOs to entities
 *
 * @example
 * const entities = toEntityArray(TotoEntity, dtos);
 */
export function toEntityArray<TSource extends object, TTarget extends object>(
    EntityClass: Class<TTarget>,
    sources: TSource[],
    options?: MapperOptions<TTarget>,
): TTarget[] {
    return sources.map((source) => toEntity(EntityClass, source, options));
}

/**
 * Creates a plain object (without class instance) from an entity
 * Useful for serialization and API responses
 *
 * @example
 * const plain = toPlainObject(entity, { exclude: ['password'] });
 */
export function toPlainObject<T extends object>(
    source: T,
    options?: MapperOptions<T>,
): Partial<T> {
    const target = {} as T;
    return mapProperties(source, target, options);
}

/**
 * Core mapping implementation
 * Handles the actual property copying with all options
 */
function mapProperties<TSource extends object, TTarget extends object>(
    source: TSource,
    target: TTarget,
    options?: MapperOptions<TTarget>,
): TTarget {
    const {
        exclude = [],
        include,
        transform = {},
        skipUndefined = false,
        skipNull = false,
        deepClone = false,
    } = options || {};

    const excludeSet = new Set(exclude.map(String));
    const includeSet = include ? new Set(include.map(String)) : null;

    for (const [key, value] of Object.entries(source)) {
        // Skip if explicitly excluded
        if (excludeSet.has(key)) continue;

        // Skip if include list is specified and key is not in it
        if (includeSet && !includeSet.has(key)) continue;

        // Skip undefined values if configured
        if (skipUndefined && value === undefined) continue;

        // Skip null values if configured
        if (skipNull && value === null) continue;

        // Apply custom transformer if available
        const transformer = (transform as any)[key];
        if (transformer) {
            (target as any)[key] = transformer(value);
            continue;
        }

        // Deep clone if configured
        if (deepClone && value !== null && typeof value === 'object') {
            (target as any)[key] = deepCloneValue(value);
            continue;
        }

        // Simple assignment
        (target as any)[key] = value;
    }

    return target;
}

/**
 * Deep clones a value with circular reference protection
 */
function deepCloneValue(value: any, seen = new WeakMap()): any {
    // Handle primitives and null
    if (value === null || typeof value !== 'object') {
        return value;
    }

    // Handle circular references
    if (seen.has(value)) {
        return seen.get(value);
    }

    // Handle Date
    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    // Handle Array
    if (Array.isArray(value)) {
        const clone: any[] = [];
        seen.set(value, clone);
        for (const item of value) {
            clone.push(deepCloneValue(item, seen));
        }
        return clone;
    }

    // Handle Object
    const clone: any = {};
    seen.set(value, clone);
    for (const [key, val] of Object.entries(value)) {
        clone[key] = deepCloneValue(val, seen);
    }

    return clone;
}

/**
 * Type-safe Pick utility - creates a new object with only specified fields
 *
 * @example
 * const summary = pick(entity, ['id', 'name', 'status']);
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const result = {} as Pick<T, K>;
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
}

/**
 * Type-safe Omit utility - creates a new object excluding specified fields
 *
 * @example
 * const publicData = omit(entity, ['password', 'secretKey']);
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
    const result = { ...obj } as any;
    for (const key of keys) {
        delete result[key];
    }
    return result;
}

/**
 * Common date transformer for converting Date to ISO string
 */
export const dateToISOString = (date: Date | null | undefined): string | null => {
    return date instanceof Date ? date.toISOString() : null;
};

/**
 * Common transformer for removing sensitive data
 */
export const maskSensitiveData = (value: string, visibleChars = 4): string => {
    if (!value || value.length <= visibleChars) return '****';
    return value.slice(0, visibleChars) + '*'.repeat(value.length - visibleChars);
};
